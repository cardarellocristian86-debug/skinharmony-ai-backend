import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeEmbeddedSoftwareArtifact,
  decodeEmbeddedArtifact,
  embeddedComponentManifest,
  MAX_EMBEDDED_ARTIFACT_BYTES,
} from "../src/embeddedSoftwareIntelligence.js";
import { deterministicBranchGroups, deterministicBranchRegistry } from "../branches/index.js";
import { routeNyraBranches } from "../src/nyraBranchNetwork.js";

const authorization = Object.freeze({ asserted: true, basis: "owned", purpose: "testing" });

function artifact(buffer, name = "fixture.bin") {
  return { name, content_base64: buffer.toString("base64") };
}

function elf64Fixture() {
  const buffer = Buffer.alloc(128);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(buffer, 0);
  buffer.writeUInt16LE(2, 16);
  buffer.writeUInt16LE(0x3e, 18);
  buffer.writeUInt32LE(1, 20);
  buffer.writeBigUInt64LE(0x401000n, 24);
  buffer.writeBigUInt64LE(64n, 32);
  buffer.writeBigUInt64LE(0n, 40);
  buffer.writeUInt16LE(64, 52);
  buffer.writeUInt16LE(56, 54);
  buffer.writeUInt16LE(2, 56);
  buffer.writeUInt16LE(64, 58);
  buffer.writeUInt16LE(0, 60);
  Buffer.from("libc.so.6\0fixture_main\0", "ascii").copy(buffer, 72);
  return buffer;
}

function pe64Fixture() {
  const buffer = Buffer.alloc(512);
  buffer.write("MZ", 0, "ascii");
  buffer.writeUInt32LE(0x80, 0x3c);
  Buffer.from([0x50, 0x45, 0, 0]).copy(buffer, 0x80);
  buffer.writeUInt16LE(0xaa64, 0x84);
  buffer.writeUInt16LE(3, 0x86);
  buffer.writeUInt32LE(1_700_000_000, 0x88);
  buffer.writeUInt16LE(0xf0, 0x94);
  buffer.writeUInt16LE(0x2022, 0x96);
  buffer.writeUInt16LE(0x20b, 0x98);
  buffer.writeUInt32LE(0x1234, 0xa8);
  Buffer.from("KERNEL32.dll\0token=do-not-return-this-secret\0", "ascii").copy(buffer, 0x180);
  return buffer;
}

function machoArm64Fixture() {
  const buffer = Buffer.alloc(96);
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]).copy(buffer, 0);
  buffer.writeUInt32LE(0x0100000c, 4);
  buffer.writeUInt32LE(0, 8);
  buffer.writeUInt32LE(2, 12);
  buffer.writeUInt32LE(3, 16);
  buffer.writeUInt32LE(64, 20);
  buffer.writeUInt32LE(0x200000, 24);
  Buffer.from("@rpath/AppKit.framework/AppKit\0", "ascii").copy(buffer, 40);
  return buffer;
}

test("embedded component manifest distinguishes active code from vendor imports", () => {
  const manifest = embeddedComponentManifest();
  assert.equal(manifest.desktop_application_required, false);
  assert.equal(manifest.components.find((item) => item.id === "skinharmony_binary_evidence_core").status, "embedded_active");
  assert.equal(manifest.components.find((item) => item.id === "ghidra_analysis_components").status, "vendor_import_required");
  assert.equal(manifest.components.find((item) => item.id === "frida_gum_components").status, "vendor_import_required");
});

test("detects ELF x86_64 and emits reproducible evidence without execution", () => {
  const result = analyzeEmbeddedSoftwareArtifact({ artifact: artifact(elf64Fixture(), "fixture.elf"), authorization });
  assert.equal(result.executable.format, "elf");
  assert.equal(result.executable.architecture, "x86_64");
  assert.equal(result.executable.bits, 64);
  assert.equal(result.executable.entry_point, "0x401000");
  assert.equal(result.executable.program_header_count, 2);
  assert.match(result.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.capability_boundary.file_executed, false);
  assert.equal(result.capability_boundary.decompiled, false);
  assert(result.evidence.printable_strings.samples.some((item) => item.value.includes("libc.so.6")));
});

test("detects PE arm64 and redacts possible secrets in string evidence", () => {
  const result = analyzeEmbeddedSoftwareArtifact({ artifact: artifact(pe64Fixture(), "fixture.exe"), authorization });
  assert.equal(result.executable.format, "pe");
  assert.equal(result.executable.architecture, "arm64");
  assert.equal(result.executable.bits, 64);
  assert.equal(result.executable.entry_point, "0x1234");
  assert.equal(result.executable.section_count, 3);
  const serialized = JSON.stringify(result.evidence.printable_strings);
  assert(!serialized.includes("do-not-return-this-secret"));
  assert(serialized.includes("[REDACTED]"));
});

test("detects Mach-O arm64 and preserves load-command evidence", () => {
  const result = analyzeEmbeddedSoftwareArtifact({ artifact: artifact(machoArm64Fixture(), "fixture.app"), authorization });
  assert.equal(result.executable.format, "macho");
  assert.equal(result.executable.architecture, "arm64");
  assert.equal(result.executable.bits, 64);
  assert.equal(result.executable.load_command_count, 3);
  assert.equal(result.executable.load_commands_size, 64);
});

test("fails closed on absent authorization, invalid payload, and oversized artifacts", () => {
  assert.throws(
    () => analyzeEmbeddedSoftwareArtifact({ artifact: artifact(Buffer.from("hello")), authorization: {} }),
    /software_analysis_authorization_assertion_required/,
  );
  assert.throws(
    () => analyzeEmbeddedSoftwareArtifact({ artifact: artifact(Buffer.from("hello")), authorization: { asserted: true, basis: "unknown", purpose: "testing" } }),
    /software_analysis_authorization_basis_invalid/,
  );
  assert.throws(() => decodeEmbeddedArtifact({ content_base64: "not base64" }), /software_artifact_base64_invalid/);
  assert.throws(
    () => decodeEmbeddedArtifact({ content_base64: Buffer.alloc(MAX_EMBEDDED_ARTIFACT_BYTES + 1).toString("base64") }),
    /software_artifact_too_large/,
  );
});

test("Nyra opens its software branch and Core exposes the governed lab", () => {
  const route = routeNyraBranches({ text: "Analizza questo software con Ghidra e Frida per test di interoperabilita", domainPackId: "generic" });
  assert(route.opened_branches.some((item) => item.id === "software_intelligence"));
  const registry = deterministicBranchRegistry();
  assert.equal(registry.software_binary_intelligence.domain, "software_intelligence");
  assert.equal(registry.software_binary_intelligence.subbranches.length, 20);
  assert(deterministicBranchGroups().software_intelligence_lab.branches.includes("software_binary_intelligence"));
});
