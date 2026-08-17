import { softwareDigest } from "./softwareCognition.js";
import { buildResearchPlan as buildCoreResearchPlan } from "./researchCortex.js";

export const SOFTWARE_RESEARCH_SCHEMA_VERSION = "nyra_software_research_v1_1";
export const NYRA_PRECORE_DECISION_SCHEMA_VERSION = "nyra_precore_decision_v1";

const SOURCE_CATALOG = Object.freeze({
  rust: [
    ["official_reference", "https://doc.rust-lang.org/reference/"],
    ["package_reference", "https://crates.io/"],
    ["package_documentation", "https://docs.rs/"],
    ["vendor_security_advisory", "https://rustsec.org/advisories/"],
    ["security_advisory", "https://osv.dev/"],
  ],
  javascript: [
    ["official_reference", "https://developer.mozilla.org/en-US/docs/Web/JavaScript"],
    ["runtime_reference", "https://nodejs.org/docs/latest/api/"],
    ["package_reference", "https://www.npmjs.com/"],
    ["vendor_security_advisory", "https://nodejs.org/en/blog/vulnerability/"],
    ["security_advisory", "https://osv.dev/"],
  ],
  typescript: [
    ["official_reference", "https://www.typescriptlang.org/docs/"],
    ["runtime_reference", "https://nodejs.org/docs/latest/api/"],
    ["package_reference", "https://www.npmjs.com/"],
    ["vendor_security_advisory", "https://nodejs.org/en/blog/vulnerability/"],
    ["security_advisory", "https://osv.dev/"],
  ],
  python: [
    ["official_reference", "https://docs.python.org/3/"],
    ["package_reference", "https://pypi.org/"],
    ["vendor_security_advisory", "https://www.python.org/dev/security/"],
    ["security_advisory", "https://osv.dev/"],
  ],
  go: [
    ["official_reference", "https://go.dev/doc/"],
    ["package_reference", "https://pkg.go.dev/"],
    ["vendor_security_advisory", "https://vuln.go.dev/"],
    ["security_advisory", "https://osv.dev/"],
  ],
  java: [
    ["official_reference", "https://docs.oracle.com/en/java/"],
    ["package_reference", "https://central.sonatype.com/"],
    ["vendor_security_advisory", "https://www.oracle.com/security-alerts/"],
    ["security_advisory", "https://osv.dev/"],
  ],
  kotlin: [
    ["official_reference", "https://kotlinlang.org/docs/home.html"],
    ["package_reference", "https://central.sonatype.com/"],
    ["vendor_security_advisory", "https://kotlinlang.org/docs/security.html"],
    ["security_advisory", "https://osv.dev/"],
  ],
  dotnet: [
    ["official_reference", "https://learn.microsoft.com/en-us/dotnet/"],
    ["package_reference", "https://www.nuget.org/"],
    ["vendor_security_advisory", "https://msrc.microsoft.com/update-guide/"],
    ["security_advisory", "https://osv.dev/"],
  ],
  ruby: [
    ["official_reference", "https://docs.ruby-lang.org/en/"],
    ["package_reference", "https://rubygems.org/"],
    ["security_advisory", "https://osv.dev/"],
  ],
  php: [
    ["official_reference", "https://www.php.net/docs.php"],
    ["package_reference", "https://packagist.org/"],
    ["security_advisory", "https://osv.dev/"],
  ],
  swift: [
    ["official_reference", "https://www.swift.org/documentation/"],
    ["package_reference", "https://swiftpackageindex.com/"],
    ["security_advisory", "https://osv.dev/"],
  ],
  c_cpp: [
    ["official_reference", "https://en.cppreference.com/w/"],
    ["compiler_reference", "https://clang.llvm.org/docs/"],
    ["package_reference", "https://conan.io/center/"],
    ["security_advisory", "https://osv.dev/"],
  ],
});

const adapter = (tool, args = [], evidence = "tool_receipt") => Object.freeze({ tool, args, evidence, sandbox_required: true });
const TECHNOLOGY_ADAPTERS = Object.freeze({
  rust: { language: "rust", runtimes: ["rustc"], version_detectors: [adapter("rustc", ["--version"]), adapter("cargo", ["--version"])],
    manifest_types: ["Cargo.toml"], lockfile_types: ["Cargo.lock"], framework_detectors: ["Cargo.toml:dependencies"],
    parser_semantic_adapter: "rust_analyzer_semantic_model", compiler_type_checker: [adapter("cargo", ["check", "--locked"])],
    lint_static_analysis: [adapter("cargo", ["clippy", "--locked", "--", "-D", "warnings"])], test_adapters: [adapter("cargo", ["test", "--locked"])],
    dependency_adapters: [adapter("cargo", ["metadata", "--locked", "--format-version", "1"]), adapter("cargo-audit", ["audit", "--json"])],
  },
  javascript: { language: "javascript", runtimes: ["node"], version_detectors: [adapter("node", ["--version"]), adapter("npm", ["--version"])],
    manifest_types: ["package.json"], lockfile_types: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"], framework_detectors: ["package.json:dependencies", "package.json:devDependencies"],
    parser_semantic_adapter: "typescript_compiler_api_js", compiler_type_checker: [adapter("node", ["--check", "{file}"])],
    lint_static_analysis: [adapter("npm", ["exec", "--", "eslint", "."])], test_adapters: [adapter("npm", ["test", "--", "--runInBand"])],
    dependency_adapters: [adapter("npm", ["ls", "--all", "--json"]), adapter("npm", ["audit", "--json"])],
  },
  typescript: { language: "typescript", runtimes: ["node"], version_detectors: [adapter("node", ["--version"]), adapter("tsc", ["--version"])],
    manifest_types: ["package.json", "tsconfig.json"], lockfile_types: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"], framework_detectors: ["package.json:dependencies", "tsconfig.json:compilerOptions"],
    parser_semantic_adapter: "typescript_compiler_api", compiler_type_checker: [adapter("tsc", ["--noEmit", "--pretty", "false"])],
    lint_static_analysis: [adapter("npm", ["exec", "--", "eslint", "."])], test_adapters: [adapter("npm", ["test", "--", "--runInBand"])],
    dependency_adapters: [adapter("npm", ["ls", "--all", "--json"]), adapter("npm", ["audit", "--json"])],
  },
  python: { language: "python", runtimes: ["python"], version_detectors: [adapter("python", ["--version"]), adapter("pip", ["--version"])],
    manifest_types: ["pyproject.toml", "setup.py", "requirements.txt"], lockfile_types: ["poetry.lock", "Pipfile.lock", "uv.lock"], framework_detectors: ["pyproject.toml:dependencies", "requirements.txt"],
    parser_semantic_adapter: "python_ast", compiler_type_checker: [adapter("python", ["-m", "compileall", "-q", "."]), adapter("python", ["-m", "mypy", "."])],
    lint_static_analysis: [adapter("python", ["-m", "ruff", "check", "."])], test_adapters: [adapter("python", ["-m", "pytest", "-q"])],
    dependency_adapters: [adapter("python", ["-m", "pip", "freeze"]), adapter("python", ["-m", "pip_audit", "-f", "json"])],
  },
  go: { language: "go", runtimes: ["go"], version_detectors: [adapter("go", ["version"]), adapter("go", ["env", "GOVERSION"])],
    manifest_types: ["go.mod"], lockfile_types: ["go.sum"], framework_detectors: ["go.mod:require"], parser_semantic_adapter: "go_parser_go_types",
    compiler_type_checker: [adapter("go", ["build", "./..."])], lint_static_analysis: [adapter("go", ["vet", "./..."])],
    test_adapters: [adapter("go", ["test", "./..."])], dependency_adapters: [adapter("go", ["list", "-m", "-json", "all"]), adapter("govulncheck", ["./..."])],
  },
  java: { language: "java", runtimes: ["jvm"], version_detectors: [adapter("java", ["--version"]), adapter("javac", ["--version"])],
    manifest_types: ["pom.xml", "build.gradle", "build.gradle.kts"], lockfile_types: ["gradle.lockfile", "maven-sha-lock.xml"], framework_detectors: ["pom.xml:dependencies", "build.gradle:dependencies"],
    parser_semantic_adapter: "javac_tree_api", compiler_type_checker: [adapter("mvn", ["-B", "-DskipTests", "compile"]), adapter("gradle", ["compileJava", "--no-daemon"])],
    lint_static_analysis: [adapter("mvn", ["-B", "verify", "-DskipTests"])], test_adapters: [adapter("mvn", ["-B", "test"]), adapter("gradle", ["test", "--no-daemon"])],
    dependency_adapters: [adapter("mvn", ["-B", "dependency:tree"]), adapter("osv-scanner", ["--recursive", "."])],
  },
  kotlin: { language: "kotlin", runtimes: ["jvm"], version_detectors: [adapter("kotlinc", ["-version"]), adapter("java", ["--version"])],
    manifest_types: ["build.gradle.kts", "pom.xml"], lockfile_types: ["gradle.lockfile"], framework_detectors: ["build.gradle.kts:dependencies"], parser_semantic_adapter: "kotlin_analysis_api",
    compiler_type_checker: [adapter("gradle", ["compileKotlin", "--no-daemon"])], lint_static_analysis: [adapter("gradle", ["detekt", "--no-daemon"])],
    test_adapters: [adapter("gradle", ["test", "--no-daemon"])], dependency_adapters: [adapter("gradle", ["dependencies", "--no-daemon"]), adapter("osv-scanner", ["--recursive", "."])],
  },
  dotnet: { language: "dotnet", runtimes: ["dotnet"], version_detectors: [adapter("dotnet", ["--info"]), adapter("dotnet", ["--list-sdks"])],
    manifest_types: ["*.csproj", "*.fsproj", "*.sln"], lockfile_types: ["packages.lock.json"], framework_detectors: ["project:PackageReference", "project:FrameworkReference"], parser_semantic_adapter: "roslyn_semantic_model",
    compiler_type_checker: [adapter("dotnet", ["build", "--no-restore"])], lint_static_analysis: [adapter("dotnet", ["format", "--verify-no-changes", "--no-restore"])],
    test_adapters: [adapter("dotnet", ["test", "--no-build"])], dependency_adapters: [adapter("dotnet", ["list", "package", "--include-transitive"]), adapter("dotnet", ["list", "package", "--vulnerable"])],
  },
  ruby: { language: "ruby", runtimes: ["ruby"], version_detectors: [adapter("ruby", ["--version"]), adapter("bundle", ["--version"])], manifest_types: ["Gemfile", "*.gemspec"], lockfile_types: ["Gemfile.lock"],
    framework_detectors: ["Gemfile"], parser_semantic_adapter: "prism_ast", compiler_type_checker: [adapter("ruby", ["-c", "{file}"])], lint_static_analysis: [adapter("bundle", ["exec", "rubocop"])],
    test_adapters: [adapter("bundle", ["exec", "rspec"])], dependency_adapters: [adapter("bundle", ["list"]), adapter("bundle-audit", ["check", "--update"])],
  },
  php: { language: "php", runtimes: ["php"], version_detectors: [adapter("php", ["--version"]), adapter("composer", ["--version"])], manifest_types: ["composer.json"], lockfile_types: ["composer.lock"],
    framework_detectors: ["composer.json:require"], parser_semantic_adapter: "php_parser_ast", compiler_type_checker: [adapter("php", ["-l", "{file}"]), adapter("vendor/bin/phpstan", ["analyse"])],
    lint_static_analysis: [adapter("vendor/bin/phpcs", [])], test_adapters: [adapter("vendor/bin/phpunit", [])], dependency_adapters: [adapter("composer", ["show", "--locked", "--format=json"]), adapter("composer", ["audit", "--format=json"])],
  },
  swift: { language: "swift", runtimes: ["swift"], version_detectors: [adapter("swift", ["--version"])], manifest_types: ["Package.swift"], lockfile_types: ["Package.resolved"], framework_detectors: ["Package.swift:dependencies"],
    parser_semantic_adapter: "swift_syntax", compiler_type_checker: [adapter("swift", ["build"])], lint_static_analysis: [adapter("swiftlint", ["lint", "--strict"])], test_adapters: [adapter("swift", ["test"])],
    dependency_adapters: [adapter("swift", ["package", "show-dependencies", "--format", "json"]), adapter("osv-scanner", ["--recursive", "."])],
  },
  c_cpp: { language: "c_cpp", runtimes: ["native"], version_detectors: [adapter("clang", ["--version"]), adapter("cmake", ["--version"])], manifest_types: ["CMakeLists.txt", "meson.build", "Makefile"], lockfile_types: ["conan.lock", "vcpkg-lock.json"],
    framework_detectors: ["CMakeLists.txt:find_package", "meson.build:dependency"], parser_semantic_adapter: "clang_ast", compiler_type_checker: [adapter("cmake", ["--build", "build", "--config", "Release"])],
    lint_static_analysis: [adapter("clang-tidy", ["{file}", "--"]), adapter("scan-build", ["cmake", "--build", "build"])], test_adapters: [adapter("ctest", ["--test-dir", "build", "--output-on-failure"])],
    dependency_adapters: [adapter("osv-scanner", ["--recursive", "."])],
  },
});

const PATH_RULES = Object.freeze([
  ["rust", /(?:^|\/)(?:Cargo\.toml|Cargo\.lock)$|\.rs$/i],
  ["typescript", /(?:^|\/)(?:tsconfig[^/]*\.json)$|\.[cm]?tsx?$/i],
  ["javascript", /(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock)$|\.[cm]?jsx?$/i],
  ["python", /(?:^|\/)(?:pyproject\.toml|requirements[^/]*\.txt|Pipfile|poetry\.lock)$|\.py$/i],
  ["go", /(?:^|\/)go\.(?:mod|sum)$|\.go$/i],
  ["java", /(?:^|\/)(?:pom\.xml|build\.gradle(?:\.kts)?)$|\.java$/i],
  ["kotlin", /\.kts?$/i],
  ["dotnet", /\.(?:cs|fs|vb|csproj|fsproj|sln)$/i],
  ["ruby", /(?:^|\/)(?:Gemfile|Gemfile\.lock)$|\.rb$/i],
  ["php", /(?:^|\/)composer\.(?:json|lock)$|\.php$/i],
  ["swift", /(?:^|\/)Package\.swift$|\.swift$/i],
  ["c_cpp", /\.(?:c|h|cc|cpp|cxx|hpp|hh)$/i],
]);

const SOURCE_CLASS = Object.freeze({
  official_reference: "OFFICIAL_DOCUMENTATION",
  runtime_reference: "OFFICIAL_DOCUMENTATION",
  compiler_reference: "OFFICIAL_DOCUMENTATION",
  package_reference: "OFFICIAL_PACKAGE_REGISTRY",
  package_documentation: "OFFICIAL_DOCUMENTATION",
  security_advisory: "INDEPENDENT_SECURITY_DATABASE",
  vendor_security_advisory: "VENDOR_SECURITY_ADVISORY",
  official_extension: "OFFICIAL_DOCUMENTATION",
});
const KNOWLEDGE_GAPS = new Set(["UNKNOWN_LANGUAGE", "UNKNOWN_RUNTIME", "UNKNOWN_FRAMEWORK", "UNKNOWN_VERSION", "UNKNOWN_API",
  "UNKNOWN_DEPENDENCY", "UNKNOWN_DYNAMIC_BEHAVIOR", "MISSING_SEMANTIC_ADAPTER", "MISSING_TOOLCHAIN", "MISSING_PRIMARY_SOURCE",
  "MISSING_SECURITY_ADVISORY", "STALE_EVIDENCE", "SOURCE_CONFLICT", "VERSION_MISMATCH", "RUNTIME_NOT_OBSERVED"]);

function sourceDescriptor(technology, sourceType, rawUrl, { version = null, versionBasis = null } = {}) {
  const url = canonicalUrl(rawUrl);
  const publisher = sourceDomain(url);
  return { source_id: `src_${softwareDigest({ technology, url }).slice(0, 32)}`, exact_url: url, url,
    title: `${technology} ${sourceType.replaceAll("_", " ")}`, publisher, source_type: sourceType,
    source_class: SOURCE_CLASS[sourceType] || "SECONDARY_TECHNICAL_SOURCE",
    official_status: sourceType === "security_advisory" ? "independent" : "official", technology,
    version_applicability: version ? { state: "EXACT_URL_BINDING", version: String(version), basis: versionBasis }
      : { state: "UNSCOPED", version: null, basis: null },
    lineage_id: `lineage_${softwareDigest(publisher).slice(0, 32)}`, primary: sourceType !== "security_advisory" };
}

function exactVersionSource(technology, rawVersion) {
  const version = String(rawVersion || "").trim().replace(/^v/, "");
  if (!/^\d+(?:\.\d+){0,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) return null;
  const major = version.split(".")[0];
  const urls = {
    typescript: `https://www.npmjs.com/package/typescript/v/${version}`,
    javascript: `https://nodejs.org/download/release/v${version}/docs/api/`,
    python: `https://www.python.org/downloads/release/python-${version.replaceAll(".", "")}/`,
    rust: `https://doc.rust-lang.org/${version}/`,
    go: `https://go.dev/doc/go${version}`,
    java: version === major ? `https://docs.oracle.com/en/java/javase/${major}/docs/api/` : null,
    kotlin: `https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/${version}/`,
    dotnet: `https://www.nuget.org/packages/Microsoft.NETCore.App.Ref/${version}`,
  };
  const url = urls[technology];
  return url ? sourceDescriptor(technology, "official_reference", url,
    { version, versionBasis: "server_derived_versioned_official_or_registry_url" }) : null;
}

function knowledgeGap(category, input = {}) {
  if (!KNOWLEDGE_GAPS.has(category)) fail("software_knowledge_gap_category_invalid");
  const result = { category, severity: input.severity || "blocking", impact: input.impact || "prevents_propose",
    technology: input.technology || null, version: input.version || null, code_locations: [...new Set(input.code_locations || [])].sort(),
    research_attempted: input.research_attempted === true, missing_sources: [...new Set(input.missing_sources || [])].sort(),
    resolution_condition: input.resolution_condition || "authoritative_evidence_required", decision_effect: input.decision_effect || "ABSTAIN" };
  return { ...result, gap_digest: softwareDigest(result) };
}

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function boundedText(value, code, maximum = 4_000) {
  const result = String(value || "").trim();
  if (!result || result.length > maximum) fail(code);
  return result;
}
function canonicalUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || "")); } catch { fail("software_research_source_url_invalid"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash) fail("software_research_source_url_invalid");
  parsed.search = "";
  return parsed.toString();
}
function sourceDomain(value) { return new URL(value).hostname.toLowerCase(); }
function domainWithin(hostname, allowed) { return hostname === allowed || hostname.endsWith(`.${allowed}`); }

export function detectSoftwareTechnologies({ graph, technology_hints = [] } = {}) {
  const detected = new Map();
  for (const node of graph?.nodes || []) {
    const sourceRef = String(node.source_ref || "").split("#", 1)[0];
    for (const [technology, pattern] of PATH_RULES) if (pattern.test(sourceRef)) {
      const current = detected.get(technology) || { technology, confidence: 0, evidence_refs: [] };
      current.confidence = Math.max(current.confidence, node.kind === "configuration" ? 1 : 0.9);
      current.evidence_refs.push(sourceRef);
      detected.set(technology, current);
    }
  }
  for (const rawHint of technology_hints || []) {
    const hint = String(rawHint || "").trim().toLowerCase();
    if (!SOURCE_CATALOG[hint]) continue;
    const current = detected.get(hint) || { technology: hint, confidence: 0.55, evidence_refs: [] };
    current.hypothesis_only = current.evidence_refs.length === 0;
    detected.set(hint, current);
  }
  return [...detected.values()].map((item) => ({ ...item, evidence_refs: [...new Set(item.evidence_refs)].sort().slice(0, 20) }))
    .sort((left, right) => left.technology.localeCompare(right.technology));
}

export function buildTechnologyProfiles(input = {}) {
  const detectedTechnologies = detectSoftwareTechnologies(input);
  if (!detectedTechnologies.length) {
    const fallback = { schema_version: "technology_profile_v1", profile_id: "technology:unknown:v1", technology: "unknown",
      language: "UNKNOWN_TECHNOLOGY", runtimes: [], detection: { confidence: 0, evidence_refs: [], hypothesis_only: true },
      version_detectors: [], manifest_types: [], lockfile_types: [], framework_detectors: [], parser_semantic_adapter: null,
      compiler_type_checker: [], lint_static_analysis: [], test_adapters: [], dependency_adapters: [], official_documentation_roots: [],
      package_registries: [], upstream_repository_rules: [], security_advisory_sources: [], support_level: "DISCOVERY_ONLY",
      freshness_rules: { discovery_max_age_seconds: 3_600 }, minimum_evidence_coverage: { official_sources: 1 },
      knowledge_gaps: [knowledgeGap("UNKNOWN_LANGUAGE"), knowledgeGap("MISSING_SEMANTIC_ADAPTER")],
      adapter_execution: { authority: "sandboxed_worker_only", execution_authorized: false, receipts_required: true,
        core_final_verdict_required: true, placeholders_must_be_server_resolved: true } };
    return [{ ...fallback, profile_digest: softwareDigest(fallback) }];
  }
  return detectedTechnologies.map((detected) => {
    const adapters = TECHNOLOGY_ADAPTERS[detected.technology];
    const sources = SOURCE_CATALOG[detected.technology].map(([sourceType, url]) => sourceDescriptor(detected.technology, sourceType, url));
    const result = {
      schema_version: "technology_profile_v1",
      profile_id: `technology:${detected.technology}:v1`,
      technology: detected.technology,
      language: adapters.language,
      runtimes: adapters.runtimes,
      detection: { confidence: detected.confidence, evidence_refs: detected.evidence_refs, hypothesis_only: detected.hypothesis_only === true },
      version_detectors: adapters.version_detectors,
      manifest_types: adapters.manifest_types,
      lockfile_types: adapters.lockfile_types,
      framework_detectors: adapters.framework_detectors,
      parser_semantic_adapter: adapters.parser_semantic_adapter,
      compiler_type_checker: adapters.compiler_type_checker,
      lint_static_analysis: adapters.lint_static_analysis,
      test_adapters: adapters.test_adapters,
      dependency_adapters: adapters.dependency_adapters,
      official_documentation_roots: sources.filter((item) => item.source_class === "OFFICIAL_DOCUMENTATION"),
      package_registries: sources.filter((item) => item.source_type === "package_reference"),
      security_advisory_sources: sources.filter((item) => ["VENDOR_SECURITY_ADVISORY", "INDEPENDENT_SECURITY_DATABASE"].includes(item.source_class)),
      upstream_repository_rules: [{ discovery: "package_metadata_then_verified_upstream_repository", redirects_allowed: false }],
      support_level: "TOOLCHAIN_ASSISTED",
      freshness_rules: { version_evidence_max_age_seconds: 3_600, documentation_max_age_seconds: 86_400,
        security_advisory_max_age_seconds: 3_600, runtime_observation_max_age_seconds: 900 },
      minimum_evidence_coverage: { compiler_or_type_checker: 1, tests: 1, lint_or_static_analysis: 1,
        dependency_inventory: 1, official_sources: 1, independent_sources_normal: 2, independent_sources_high_risk: 3,
        security_advisory_high_risk: 1, fresh_runtime_observation: 1 },
      adapter_execution: { authority: "sandboxed_worker_only", execution_authorized: false, receipts_required: true,
        core_final_verdict_required: true, placeholders_must_be_server_resolved: true },
    };
    return { ...result, profile_digest: softwareDigest(result) };
  });
}

export function buildSoftwareResearchPlan(input = {}) {
  const question = boundedText(input.question, "software_research_question_required", 8_000);
  const technologies = detectSoftwareTechnologies(input);
  const technologyProfiles = buildTechnologyProfiles(input);
  const securitySensitive = /auth|authori[sz]|credential|secret|crypto|security|vulnerab|tenant|payment|privacy/i.test(question)
    || (input.graph?.nodes || []).some((node) => /auth|security|secret|credential|tenant|payment/i.test(String(node.source_ref || "")));
  const requestedRisk = String(input.risk_tier || "normal").toLowerCase();
  if (!["normal", "high", "security_critical"].includes(requestedRisk)) fail("software_research_risk_tier_invalid");
  const riskTier = securitySensitive ? "security_critical" : requestedRisk;
  const minimumSources = riskTier === "normal" ? 2 : 3;
  const selected = [];
  for (const item of technologies) {
    const versionSource = exactVersionSource(item.technology, input.version_context?.[item.technology]);
    if (versionSource) selected.push(versionSource);
  }
  for (const item of technologies) for (const [source_type, url] of SOURCE_CATALOG[item.technology]) {
    selected.push(sourceDescriptor(item.technology, source_type, url));
  }
  const allowedDomains = new Set(selected.map((item) => sourceDomain(item.url)));
  for (const value of input.additional_source_urls || []) {
    const url = canonicalUrl(value);
    const hostname = sourceDomain(url);
    if (![...allowedDomains].some((domain) => domainWithin(hostname, domain))) fail("software_research_source_domain_not_authorized");
    if (!selected.some((item) => item.exact_url === url)) selected.push(sourceDescriptor("project_specific", "official_extension", url));
  }
  const deduped = [...new Map(selected.map((item) => [item.exact_url, item])).values()].slice(0, 20);
  const queryParts = technologies.map((item) => `${item.technology} ${String(input.version_context?.[item.technology] || "unknown version")}`);
  const minimizedQuestion = `${queryParts.join(", ")}: ${question.replace(/[\r\n`{}]/g, " ").replace(/\s+/g, " ").slice(0, 320)}`;
  const rawCortexPlan = buildCoreResearchPlan({ question: minimizedQuestion,
    decision_context: "NSCT V1.1 governed technical evidence gap", allowed_domains: [...new Set(deduped.map((item) => item.publisher))] },
  { now: new Date(0) });
  const { plan_id: ignoredPlanId, created_at: ignoredCreatedAt, ...cortexContract } = rawCortexPlan;
  const cortexPlan = { ...cortexContract, plan_id: `rp_${softwareDigest(cortexContract).slice(0, 40)}`, created_at: null };
  const knowledgeGaps = [];
  if (!technologies.length) knowledgeGaps.push(knowledgeGap("UNKNOWN_LANGUAGE", { code_locations: (input.graph?.nodes || []).map((node) => node.source_ref).filter(Boolean) }));
  if (!deduped.some((item) => item.primary)) knowledgeGaps.push(knowledgeGap("MISSING_PRIMARY_SOURCE"));
  if (!deduped.some((item) => item.source_type === "security_advisory")) knowledgeGaps.push(knowledgeGap("MISSING_SECURITY_ADVISORY"));
  if (!input.version_context || !Object.keys(input.version_context).length) knowledgeGaps.push(knowledgeGap("UNKNOWN_VERSION"));
  if (new Set(deduped.map((item) => item.lineage_id)).size < minimumSources) knowledgeGaps.push(knowledgeGap("MISSING_PRIMARY_SOURCE", { resolution_condition: "minimum_independent_lineages_required" }));
  const result = {
    schema_version: SOFTWARE_RESEARCH_SCHEMA_VERSION,
    tenant_id: boundedText(input.tenant_id, "tenant_id_required", 120),
    project_id: boundedText(input.project_id, "project_id_required", 160),
    work_id: boundedText(input.work_id, "work_id_required", 160),
    change_id: boundedText(input.change_id, "change_id_required", 160),
    plan_id: boundedText(input.plan_id, "plan_id_required", 160),
    repository_id: input.repository_id ? boundedText(input.repository_id, "repository_id_invalid", 240) : null,
    base_revision: input.base_revision ? boundedText(input.base_revision, "base_revision_invalid", 160) : null,
    candidate_revision: input.candidate_revision ? boundedText(input.candidate_revision, "candidate_revision_invalid", 160) : null,
    question,
    question_digest: softwareDigest(question),
    graph_revision: Number(input.graph?.revision),
    graph_digest: boundedText(input.graph?.source_digest, "software_graph_digest_required", 64),
    technologies,
    technology_profiles: technologyProfiles,
    version_context: input.version_context && typeof input.version_context === "object" ? input.version_context : {},
    risk_tier: riskTier,
    source_policy: {
      minimum_independent_sources: minimumSources,
      primary_source_required: true,
      security_advisory_required: riskTier !== "normal",
      vendor_security_advisory_required: riskTier !== "normal",
      independent_security_database_required: riskTier !== "normal",
      exact_version_source_required: true,
      contradictions_open_blocking_challenge: true,
    },
    research_cortex_plan: cortexPlan,
    research_cortex_plan_digest: softwareDigest(cortexPlan),
    sources: deduped,
    knowledge_gaps: knowledgeGaps,
    max_queries: 8,
    max_sources: 20,
    untrusted_evidence_only: true,
    research_required: true,
    technical_verification_required: true,
    execution_authorized: false,
    authoritative_transition_performed: false,
  };
  return { ...result, research_plan_digest: softwareDigest(result) };
}

export function validateTechnologyEvidence({ plan, profile_results = [], evidence_authority = null } = {}) {
  if (!plan || plan.schema_version !== SOFTWARE_RESEARCH_SCHEMA_VERSION || !evidence_authority?.fresh_until
    || !Number.isFinite(Date.parse(evidence_authority.fresh_until))) fail("software_technology_evidence_not_authorized");
  const results = new Map(profile_results.map((item) => [String(item.technology || ""), item]));
  if (results.size !== profile_results.length) fail("software_technology_profile_evidence_incomplete");
  const verifiedProfiles = [];
  for (const profile of plan.technology_profiles || []) {
    const result = results.get(profile.technology);
    if (!result || result.profile_digest !== profile.profile_digest || result.passed !== true || !String(result.detected_version || "").trim()) {
      fail("software_technology_profile_evidence_incomplete");
    }
    const expectedVersion = plan.version_context?.[profile.technology];
    if (!expectedVersion || String(result.detected_version).trim() !== String(expectedVersion).trim()) fail("software_technology_version_mismatch");
    const receipts = result.adapter_receipts || {};
    const receiptKeys = ["compiler_type_checker", "tests", "lint_static_analysis", "dependency_inventory"];
    if (Object.keys(receipts).sort().join(":") !== [...receiptKeys].sort().join(":")) fail("software_technology_profile_evidence_incomplete");
    for (const key of receiptKeys) {
      const values = receipts[key];
      if (!Array.isArray(values) || !values.length || values.some((value) => !/^[a-f0-9]{64}$/.test(String(value)))) fail("software_technology_profile_evidence_incomplete");
    }
    if (!Array.isArray(result.manifest_digests) || !result.manifest_digests.length
      || result.manifest_digests.some((value) => !/^[a-f0-9]{64}$/.test(String(value)))) fail("software_technology_profile_evidence_incomplete");
    if (!Array.isArray(result.lockfile_digests || []) || (result.lockfile_digests || []).some((value) => !/^[a-f0-9]{64}$/.test(String(value)))) fail("software_technology_profile_evidence_incomplete");
    verifiedProfiles.push({ technology: profile.technology, profile_digest: profile.profile_digest, detected_version: String(result.detected_version),
      frameworks: [...new Set(result.frameworks || [])].map(String).sort(), manifest_digests: [...new Set(result.manifest_digests)].sort(),
      lockfile_digests: [...new Set(result.lockfile_digests || [])].sort(), adapter_receipts: receipts, passed: true });
  }
  if (!verifiedProfiles.length || results.size !== verifiedProfiles.length) fail("software_technology_profile_evidence_incomplete");
  const result = { schema_version: "software_technology_evidence_v1", tenant_id: plan.tenant_id, project_id: plan.project_id,
    work_id: plan.work_id, change_id: plan.change_id, plan_id: plan.plan_id, research_plan_digest: plan.research_plan_digest,
    verified_profiles: verifiedProfiles, causal_evidence_digest: evidence_authority.evidence_digest,
    fresh_until: evidence_authority.fresh_until, verified: true, execution_authorized: false };
  return { ...result, technology_evidence_digest: softwareDigest(result) };
}

export function bindSoftwareResearchEvidence({ plan, capsule, sealed_evidence = null, verified = false, now = Date.now() } = {}) {
  if (!verified) fail("software_research_capsule_signature_invalid");
  if (!plan || plan.schema_version !== SOFTWARE_RESEARCH_SCHEMA_VERSION) fail("software_research_plan_invalid");
  if (capsule?.schema_version !== "research_airlock_evidence_capsule_v1") fail("software_research_capsule_invalid");
  const work = capsule.work_binding || {};
  for (const key of ["tenant_id", "project_id", "work_id"]) if (String(work[key] || "") !== String(plan[key] || "")) fail("software_research_capsule_scope_mismatch");
  if (capsule.plan_digest !== plan.airlock_plan_digest) fail("software_research_airlock_plan_mismatch");
  const allowedByDigest = new Map(plan.sources.map((item) => [softwareDigest(item.url), item]));
  const allowedDomainDigests = new Set(plan.sources.map((item) => softwareDigest(sourceDomain(item.url))));
  const observedSourceDigests = [...new Set(capsule.source_url_digests || [])];
  const observedDomainDigests = [...new Set(capsule.source_domain_digests || [])];
  if (!capsule.evidence_digest || Number(capsule.evidence_count) < Number(plan.source_policy.minimum_independent_sources)
    || Number(capsule.independent_source_count) < Number(plan.source_policy.minimum_independent_sources)
    || observedSourceDigests.length !== Number(capsule.independent_source_count)
    || Number(capsule.independent_domain_count) < Number(plan.source_policy.minimum_independent_sources)
    || observedDomainDigests.length !== Number(capsule.independent_domain_count)
    || observedSourceDigests.some((item) => !allowedByDigest.has(item))
    || observedDomainDigests.some((item) => !allowedDomainDigests.has(item))) fail("software_research_evidence_insufficient");
  const observedSources = observedSourceDigests.map((item) => allowedByDigest.get(item));
  if (new Set(observedSources.map((item) => item.lineage_id)).size < Number(plan.source_policy.minimum_independent_sources)) {
    fail("software_research_evidence_lineage_insufficient");
  }
  if (plan.source_policy.primary_source_required && !observedSources.some((item) => item.primary)) fail("software_research_primary_source_missing");
  if (plan.source_policy.exact_version_source_required && !observedSources.some((item) =>
    item.version_applicability?.state === "EXACT_URL_BINDING"
      && String(item.version_applicability.version) === String(plan.version_context?.[item.technology] || ""))) {
    fail("software_research_version_source_missing");
  }
  if (plan.source_policy.security_advisory_required && !observedSources.some((item) => item.source_type === "security_advisory")) fail("software_research_security_source_missing");
  if (plan.source_policy.vendor_security_advisory_required && !observedSources.some((item) => item.source_class === "VENDOR_SECURITY_ADVISORY")) fail("software_research_vendor_security_source_missing");
  if (plan.source_policy.independent_security_database_required && !observedSources.some((item) => item.source_class === "INDEPENDENT_SECURITY_DATABASE")) fail("software_research_independent_security_source_missing");
  if (!capsule.expires_at || Date.parse(capsule.expires_at) < Number(now)) fail("software_research_evidence_stale");
  if (!sealed_evidence || sealed_evidence.capsule_id !== capsule.capsule_id || sealed_evidence.evidence_digest !== capsule.evidence_digest
    || sealed_evidence.trust_label !== "public_untrusted_sanitized_non_executable" || sealed_evidence.execution_authorized !== false) {
    fail("software_research_sealed_evidence_required");
  }
  const evidenceByUrl = new Map((sealed_evidence.evidence || []).map((item) => [canonicalUrl(item?.source?.canonical_url), item]));
  if (evidenceByUrl.size !== observedSources.length || observedSources.some((item) => !evidenceByUrl.has(item.exact_url))) {
    fail("software_research_sealed_evidence_mismatch");
  }
  const sources = observedSources.map((source) => {
    const evidence = evidenceByUrl.get(source.exact_url);
    return { source_id: source.source_id, exact_url: source.exact_url, title: source.title, publisher: source.publisher,
      source_class: source.source_class, official_status: source.official_status, technology: source.technology,
      version_scope: source.version_applicability?.state === "EXACT_URL_BINDING" ? source.version_applicability.version : null,
      version_applicability_basis: source.version_applicability?.basis || null, published_at: null,
      retrieved_at: evidence.source?.fetched_at || null, fresh_until: capsule.expires_at,
      content_digest: softwareDigest(evidence), sanitized_content_digest: softwareDigest(evidence), lineage_id: source.lineage_id,
      airlock_receipt_id: capsule.capsule_id };
  }).sort((left, right) => left.source_id.localeCompare(right.source_id));
  const claims = [];
  for (const source of sources) {
    const evidence = evidenceByUrl.get(source.exact_url);
    for (const span of evidence.spans || []) {
      const statement = boundedText(span.text, "software_research_claim_invalid", 500);
      const claim = { statement, technology: source.technology, version_scope: source.version_scope, code_locations: [],
        requirement_refs: [], risk_refs: [], obligation_refs: [], supporting_source_refs: [source.source_id], contradicting_source_refs: [],
        tool_confirmation_refs: [], freshness_state: "FRESH", coverage_state: "DOCUMENTED_BEHAVIOR",
        confidence_basis: { required_source_classes_satisfied: false, version_verified: Boolean(source.version_scope),
          independent_lineage_count: 1, compiler_confirmed: false, tests_confirmed: false, runtime_confirmed: false, open_contradictions: 0 } };
      const claimId = `claim_${softwareDigest(claim).slice(0, 32)}`;
      claims.push({ claim_id: claimId, ...claim, claim_digest: softwareDigest({ claim_id: claimId, ...claim }) });
    }
  }
  const evidenceBundle = { schema_version: "research_evidence_bundle_v1", tenant_id: plan.tenant_id, project_id: plan.project_id,
    repository_id: plan.repository_id || null, work_id: plan.work_id, change_id: plan.change_id, candidate_revision: plan.candidate_revision || null,
    graph_revision: plan.graph_revision, graph_digest: plan.graph_digest, research_plan_digest: plan.research_plan_digest,
    security_assessment_digest: null, sources, claims, tool_confirmation_refs: [], execution_authorized: false };
  evidenceBundle.bundle_digest = softwareDigest(evidenceBundle);
  const result = {
    schema_version: "software_research_evidence_binding_v1",
    tenant_id: plan.tenant_id, project_id: plan.project_id, work_id: plan.work_id, change_id: plan.change_id, plan_id: plan.plan_id,
    research_plan_digest: plan.research_plan_digest,
    airlock_plan_digest: plan.airlock_plan_digest,
    capsule_id: capsule.capsule_id,
    evidence_digest: capsule.evidence_digest,
    evidence_count: Number(capsule.evidence_count),
    independent_source_count: Number(capsule.independent_source_count),
    independent_domain_count: Number(capsule.independent_domain_count),
    source_url_digests: observedSourceDigests.sort(),
    source_domain_digests: observedDomainDigests.sort(),
    source_urls: observedSources.map((item) => item.url).sort(),
    source_records: sources,
    source_lineage_ids: [...new Set(sources.map((item) => item.lineage_id))].sort(),
    claim_ids: claims.map((item) => item.claim_id),
    research_evidence_bundle: evidenceBundle,
    research_evidence_bundle_digest: evidenceBundle.bundle_digest,
    risk_tier: plan.risk_tier,
    verified: true,
    fresh_until: capsule.expires_at,
    contradictions: [],
    execution_authorized: false,
  };
  return { ...result, research_evidence_digest: softwareDigest(result) };
}

export function createNyraPrecoreDecision(input = {}) {
  const requestedDisposition = String(input.disposition || "ABSTAIN").trim().toUpperCase();
  if (!["PROPOSE", "CHALLENGE", "ABSTAIN", "RECOMMEND_BLOCK"].includes(requestedDisposition)) fail("nyra_precore_disposition_invalid");
  const researchReady = input.research_plan?.research_required === true && (input.research_evidence?.verified === true
    && input.research_evidence.research_plan_digest === input.research_plan.research_plan_digest
    && Date.parse(input.research_evidence.fresh_until || "") >= Date.parse(input.issued_at));
  const technicalReady = input.research_plan?.technical_verification_required === true && (input.technology_evidence?.verified === true
    && input.technology_evidence.research_plan_digest === input.research_plan.research_plan_digest
    && Date.parse(input.technology_evidence.fresh_until || "") >= Date.parse(input.issued_at));
  const authorityRefsPresent = input.bindings?.genesis?.id && input.bindings?.genesis?.digest && input.bindings?.intent?.id
    && input.bindings?.intent?.digest && input.bindings?.icf?.id && input.bindings?.icf?.digest
    && input.bindings?.graph?.digest && input.bindings?.native_plan?.digest && input.bindings?.security?.id && input.bindings?.security?.digest;
  const authorityAligned = input.bindings?.intent?.verified === true && input.bindings?.icf?.verified === true
    && input.bindings?.security?.status === "verified_no_critical_gap";
  const openGaps = [...new Set([...(input.research_plan?.knowledge_gaps || []).map((item) => item.category || item),
    ...(input.knowledge_gaps || []).map((item) => item.category || item)])].filter(Boolean).sort();
  const conflicts = [...new Set(input.research_evidence?.contradictions || [])].sort();
  const securityCritical = input.research_plan?.risk_tier === "security_critical";
  const criticalSecurityGap = input.bindings?.security?.critical === true;
  let disposition = requestedDisposition;
  if (criticalSecurityGap) disposition = "RECOMMEND_BLOCK";
  else if (!researchReady || !technicalReady || !authorityRefsPresent || openGaps.length) disposition = securityCritical ? "RECOMMEND_BLOCK" : "ABSTAIN";
  else if (!authorityAligned || conflicts.length) disposition = "CHALLENGE";
  else if (requestedDisposition === "PROPOSE") disposition = "PROPOSE";
  const result = {
    schema_version: NYRA_PRECORE_DECISION_SCHEMA_VERSION,
    nsct_version: "1.1",
    tenant_id: boundedText(input.tenant_id, "tenant_id_required", 120),
    project_id: boundedText(input.project_id, "project_id_required", 160),
    work_id: boundedText(input.work_id, "work_id_required", 160),
    change_id: boundedText(input.change_id, "change_id_required", 160),
    plan_id: boundedText(input.plan_id, "plan_id_required", 160),
    state: "NYRA_PROVISIONAL",
    core_state: "CORE_PENDING",
    authority_scope: "ADVISORY_NON_EXECUTABLE",
    disposition,
    requested_disposition: requestedDisposition,
    recommendation: boundedText(input.recommendation, "nyra_precore_recommendation_required", 8_000),
    rationale: (input.rationale || []).map((item) => boundedText(item, "nyra_precore_rationale_invalid", 2_000)).slice(0, 50),
    uncertainties: [...new Set([...(input.uncertainties || []), ...(!researchReady ? ["technical_research_evidence_incomplete"] : []),
      ...(!technicalReady ? ["technology_adapter_evidence_incomplete"] : []), ...(!authorityRefsPresent ? ["authority_reference_incomplete"] : []),
      ...(!authorityAligned && authorityRefsPresent ? ["authority_conflict"] : []), ...openGaps,
      ...conflicts.map(() => "SOURCE_CONFLICT")])].map((item) => String(item).slice(0, 500)).slice(0, 50),
    bindings: input.bindings,
    research_plan_digest: input.research_plan?.research_plan_digest || null,
    research_evidence_digest: researchReady ? input.research_evidence?.research_evidence_digest || null : null,
    technology_evidence_digest: technicalReady ? input.technology_evidence?.technology_evidence_digest || null : null,
    evidence_refs: [...new Set(input.evidence_refs || [])].sort(),
    scope: { tenant_id: input.tenant_id, project_id: input.project_id, repository_id: input.repository_id || null,
      work_id: input.work_id, change_id: input.change_id, plan_id: input.plan_id },
    subject: { base_revision: input.base_revision || null, candidate_revision: input.candidate_revision || null,
      change_digest: input.change_digest || null },
    authority_refs: input.bindings,
    decision: { next_step: disposition === "PROPOSE" ? "PROPOSE_TO_CORE_REVIEW" : disposition,
      summary: boundedText(input.recommendation, "nyra_precore_recommendation_required", 8_000),
      risks: (input.risks || []).map(String).sort().slice(0, 100), conditions: (input.conditions || []).map(String).sort().slice(0, 100),
      rollback: input.rollback || null, open_challenges: (input.open_challenges || []).map(String).sort().slice(0, 100), knowledge_gaps: openGaps },
    evidence: { claim_ids: (input.claim_ids || []).map(String).sort(), tool_result_ids: (input.tool_result_ids || []).map(String).sort(),
      coverage_state: researchReady && technicalReady ? "SUFFICIENT" : "PARTIAL", freshness_state: researchReady && technicalReady ? "FRESH" : "INVALID",
      evidence_digest: softwareDigest([...new Set(input.evidence_refs || [])].sort()) },
    issued_at: input.issued_at,
    fresh_until: input.fresh_until,
    supersedes_decision_digest: input.supersedes_decision_digest || null,
    execution_authorized: false,
    authoritative_transition_performed: false,
    core_approval_required: true,
  };
  return { ...result, decision_digest: softwareDigest(result) };
}

export const SOFTWARE_TECHNOLOGY_SOURCE_CATALOG = SOURCE_CATALOG;
