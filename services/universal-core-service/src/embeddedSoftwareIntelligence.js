import crypto from "node:crypto";

export const EMBEDDED_SOFTWARE_INTELLIGENCE_VERSION = "embedded_software_intelligence_v1";
// Base64 adds roughly 33%; 6 MiB stays below the service's default 10 MiB JSON limit.
export const MAX_EMBEDDED_ARTIFACT_BYTES = 6 * 1024 * 1024;

const AUTHORIZATION_BASES = new Set(["owned", "written_permission", "open_source"]);
const ALLOWED_PURPOSES = new Set([
  "compatibility",
  "customization",
  "debugging",
  "interoperability",
  "maintenance",
  "security_review",
  "testing",
]);

const MACHINE_TYPES = Object.freeze({
  elf: Object.freeze({
    0x03: "x86",
    0x08: "mips",
    0x14: "powerpc",
    0x28: "arm",
    0x3e: "x86_64",
    0xb7: "arm64",
    0xf3: "riscv",
  }),
  pe: Object.freeze({
    0x014c: "x86",
    0x01c0: "arm",
    0x01c4: "armv7",
    0x8664: "x86_64",
    0xaa64: "arm64",
  }),
  macho: Object.freeze({
    7: "x86",
    12: "arm",
    0x01000007: "x86_64",
    0x0100000c: "arm64",
  }),
});

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function inBounds(buffer, offset, size) {
  return Number.isInteger(offset) && Number.isInteger(size) && offset >= 0 && size >= 0 && offset + size <= buffer.length;
}

function readUInt(buffer, offset, bytes, littleEndian = true) {
  if (!inBounds(buffer, offset, bytes)) return null;
  if (bytes === 1) return buffer.readUInt8(offset);
  if (bytes === 2) return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  if (bytes === 4) return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  if (bytes === 8) {
    const value = littleEndian ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : `0x${value.toString(16)}`;
  }
  return null;
}

function hex(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : `0x${value.toString(16)}`;
}

function parseElf(buffer) {
  if (buffer.length < 20 || !buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return null;
  const classByte = buffer[4];
  const endianByte = buffer[5];
  const bits = classByte === 1 ? 32 : classByte === 2 ? 64 : null;
  const littleEndian = endianByte !== 2;
  const machine = readUInt(buffer, 18, 2, littleEndian);
  const entryOffset = bits === 64 ? 24 : 24;
  const entryBytes = bits === 64 ? 8 : 4;
  const programHeaderOffset = bits === 64 ? readUInt(buffer, 32, 8, littleEndian) : readUInt(buffer, 28, 4, littleEndian);
  const sectionHeaderOffset = bits === 64 ? readUInt(buffer, 40, 8, littleEndian) : readUInt(buffer, 32, 4, littleEndian);
  const programHeaderCount = readUInt(buffer, bits === 64 ? 56 : 44, 2, littleEndian);
  const sectionHeaderCount = readUInt(buffer, bits === 64 ? 60 : 48, 2, littleEndian);
  return {
    format: "elf",
    bits,
    endianness: littleEndian ? "little" : "big",
    architecture: MACHINE_TYPES.elf[machine] || (machine === null ? "unknown" : `elf_machine_${machine}`),
    machine_id: machine,
    entry_point: hex(readUInt(buffer, entryOffset, entryBytes, littleEndian)),
    program_header_offset: programHeaderOffset,
    program_header_count: programHeaderCount,
    section_header_offset: sectionHeaderOffset,
    section_header_count: sectionHeaderCount,
  };
}

function parsePe(buffer) {
  if (buffer.length < 64 || buffer[0] !== 0x4d || buffer[1] !== 0x5a) return null;
  const peOffset = readUInt(buffer, 0x3c, 4, true);
  if (peOffset === null || !inBounds(buffer, peOffset, 24)) return null;
  if (!buffer.subarray(peOffset, peOffset + 4).equals(Buffer.from([0x50, 0x45, 0x00, 0x00]))) return null;
  const machine = readUInt(buffer, peOffset + 4, 2, true);
  const sectionCount = readUInt(buffer, peOffset + 6, 2, true);
  const timestamp = readUInt(buffer, peOffset + 8, 4, true);
  const optionalHeaderSize = readUInt(buffer, peOffset + 20, 2, true);
  const characteristics = readUInt(buffer, peOffset + 22, 2, true);
  const optionalOffset = peOffset + 24;
  const optionalMagic = readUInt(buffer, optionalOffset, 2, true);
  const bits = optionalMagic === 0x20b ? 64 : optionalMagic === 0x10b ? 32 : null;
  const entryPointRva = readUInt(buffer, optionalOffset + 16, 4, true);
  return {
    format: "pe",
    bits,
    endianness: "little",
    architecture: MACHINE_TYPES.pe[machine] || (machine === null ? "unknown" : `pe_machine_${machine}`),
    machine_id: machine,
    entry_point: hex(entryPointRva),
    pe_header_offset: peOffset,
    section_count: sectionCount,
    optional_header_size: optionalHeaderSize,
    characteristics: hex(characteristics),
    compile_timestamp_unix: timestamp,
  };
}

function machoMagic(buffer) {
  if (buffer.length < 4) return null;
  const bytes = buffer.subarray(0, 4).toString("hex");
  const variants = {
    feedface: { bits: 32, littleEndian: false, universal: false },
    cefaedfe: { bits: 32, littleEndian: true, universal: false },
    feedfacf: { bits: 64, littleEndian: false, universal: false },
    cffaedfe: { bits: 64, littleEndian: true, universal: false },
    cafebabe: { bits: null, littleEndian: false, universal: true },
    bebafeca: { bits: null, littleEndian: true, universal: true },
    cafebabf: { bits: 64, littleEndian: false, universal: true },
    bfbafeca: { bits: 64, littleEndian: true, universal: true },
  };
  return variants[bytes] || null;
}

function parseMachO(buffer) {
  const magic = machoMagic(buffer);
  if (!magic) return null;
  if (magic.universal) {
    return {
      format: "macho_universal",
      bits: magic.bits,
      endianness: magic.littleEndian ? "little" : "big",
      architecture: "multiple",
      architecture_count: readUInt(buffer, 4, 4, magic.littleEndian),
      entry_point: null,
    };
  }
  const cpuType = readUInt(buffer, 4, 4, magic.littleEndian);
  return {
    format: "macho",
    bits: magic.bits,
    endianness: magic.littleEndian ? "little" : "big",
    architecture: MACHINE_TYPES.macho[cpuType] || (cpuType === null ? "unknown" : `macho_cpu_${cpuType}`),
    machine_id: cpuType,
    entry_point: null,
    file_type: readUInt(buffer, 12, 4, magic.littleEndian),
    load_command_count: readUInt(buffer, 16, 4, magic.littleEndian),
    load_commands_size: readUInt(buffer, 20, 4, magic.littleEndian),
    flags: hex(readUInt(buffer, 24, 4, magic.littleEndian)),
  };
}

function detectExecutable(buffer) {
  return parseElf(buffer) || parsePe(buffer) || parseMachO(buffer) || {
    format: "unknown",
    bits: null,
    endianness: null,
    architecture: "unknown",
    entry_point: null,
  };
}

function shannonEntropy(buffer) {
  if (!buffer.length) return 0;
  const frequencies = new Uint32Array(256);
  for (const byte of buffer) frequencies[byte] += 1;
  let entropy = 0;
  for (const count of frequencies) {
    if (!count) continue;
    const probability = count / buffer.length;
    entropy -= probability * Math.log2(probability);
  }
  return Number(entropy.toFixed(4));
}

function redactEvidenceString(value) {
  return String(value || "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\b(password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
}

function extractPrintableStrings(buffer, { minimumLength = 5, maximumSamples = 120 } = {}) {
  const samples = [];
  let total = 0;
  let start = -1;
  const flush = (end) => {
    if (start < 0 || end - start < minimumLength) {
      start = -1;
      return;
    }
    total += 1;
    if (samples.length < maximumSamples) {
      const raw = buffer.subarray(start, end).toString("ascii");
      samples.push({ offset: start, length: end - start, value: redactEvidenceString(raw).slice(0, 300) });
    }
    start = -1;
  };
  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (byte >= 0x20 && byte <= 0x7e) {
      if (start < 0) start = index;
    } else {
      flush(index);
    }
  }
  flush(buffer.length);
  return { total, samples, truncated: total > samples.length };
}

function validateAuthorization(authorization = {}) {
  const basis = String(authorization.basis || "").trim().toLowerCase();
  const purpose = String(authorization.purpose || "").trim().toLowerCase();
  if (authorization.asserted !== true) throw new Error("software_analysis_authorization_assertion_required");
  if (!AUTHORIZATION_BASES.has(basis)) throw new Error("software_analysis_authorization_basis_invalid");
  if (!ALLOWED_PURPOSES.has(purpose)) throw new Error("software_analysis_purpose_invalid");
  return { asserted: true, basis, purpose };
}

export function decodeEmbeddedArtifact(input = {}) {
  const name = String(input.name || "artifact.bin").trim().slice(0, 240) || "artifact.bin";
  const encoded = String(input.content_base64 || "").trim();
  if (!encoded) throw new Error("software_artifact_base64_required");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error("software_artifact_base64_invalid");
  }
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) throw new Error("software_artifact_empty");
  if (buffer.length > MAX_EMBEDDED_ARTIFACT_BYTES) throw new Error("software_artifact_too_large");
  return { name, buffer };
}

export function embeddedComponentManifest() {
  return {
    schema_version: "embedded_component_manifest_v1",
    runtime_dependency: "none",
    desktop_application_required: false,
    components: [
      {
        id: "skinharmony_binary_evidence_core",
        status: "embedded_active",
        implementation: "native_node",
        capabilities: ["elf_header", "pe_header", "macho_header", "sha256", "entropy", "redacted_strings"],
        license: "project_license",
      },
      {
        id: "ghidra_analysis_components",
        status: "vendor_import_required",
        source_policy: "exact_upstream_source_version_and_notice_required",
        license: "Apache-2.0",
      },
      {
        id: "frida_gum_components",
        status: "vendor_import_required",
        source_policy: "exact_upstream_source_version_dependency_and_notice_audit_required",
        license: "component_specific_audit_required",
      },
    ],
  };
}

export function analyzeEmbeddedSoftwareArtifact({ artifact = {}, authorization = {}, options = {} } = {}) {
  const verifiedAuthorization = validateAuthorization(authorization);
  const { name, buffer } = decodeEmbeddedArtifact(artifact);
  const executable = detectExecutable(buffer);
  const strings = extractPrintableStrings(buffer, {
    minimumLength: boundedNumber(options.minimum_string_length, 5, 4, 64),
    maximumSamples: boundedNumber(options.maximum_string_samples, 120, 0, 500),
  });
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const entropy = shannonEntropy(buffer);
  const packedOrCompressedHint = entropy >= 7.4;
  return {
    schema_version: EMBEDDED_SOFTWARE_INTELLIGENCE_VERSION,
    analysis_id: `swi_${sha256.slice(0, 20)}`,
    authorization: verifiedAuthorization,
    artifact: {
      name,
      byte_length: buffer.length,
      sha256,
      raw_content_persisted: false,
    },
    executable,
    evidence: {
      entropy: {
        value: entropy,
        packed_or_compressed_hint: packedOrCompressedHint,
        interpretation: packedOrCompressedHint ? "high_entropy_requires_additional_evidence" : "no_high_entropy_signal",
      },
      printable_strings: strings,
      coordinates: "file_offsets_zero_based",
    },
    confidence: {
      format_detection: executable.format === "unknown" ? 0.2 : 0.99,
      architecture_detection: executable.architecture === "unknown" ? 0.2 : 0.95,
      behavior_inference: 0,
      rule: "No behavior claim without runtime trace, symbol evidence, or reproducible test.",
    },
    capability_boundary: {
      static_observation_only: true,
      file_executed: false,
      decompiled: false,
      disassembled: false,
      memory_hooked: false,
      patch_generated: false,
      next_stage_requires: ["sandbox_worker", "licensed_embedded_engine", "core_governance_verdict"],
    },
    component_manifest: embeddedComponentManifest(),
  };
}
