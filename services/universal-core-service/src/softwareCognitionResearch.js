import { softwareDigest } from "./softwareCognition.js";

export const SOFTWARE_RESEARCH_SCHEMA_VERSION = "nyra_software_research_v1_1";
export const NYRA_PRECORE_DECISION_SCHEMA_VERSION = "nyra_precore_decision_v1";

const SOURCE_CATALOG = Object.freeze({
  rust: [
    ["official_reference", "https://doc.rust-lang.org/reference/"],
    ["package_reference", "https://crates.io/"],
    ["package_documentation", "https://docs.rs/"],
    ["security_advisory", "https://rustsec.org/advisories/"],
  ],
  javascript: [
    ["official_reference", "https://developer.mozilla.org/en-US/docs/Web/JavaScript"],
    ["runtime_reference", "https://nodejs.org/docs/latest/api/"],
    ["package_reference", "https://www.npmjs.com/"],
    ["security_advisory", "https://osv.dev/"],
  ],
  typescript: [
    ["official_reference", "https://www.typescriptlang.org/docs/"],
    ["runtime_reference", "https://nodejs.org/docs/latest/api/"],
    ["package_reference", "https://www.npmjs.com/"],
    ["security_advisory", "https://osv.dev/"],
  ],
  python: [
    ["official_reference", "https://docs.python.org/3/"],
    ["package_reference", "https://pypi.org/"],
    ["security_advisory", "https://osv.dev/"],
  ],
  go: [
    ["official_reference", "https://go.dev/doc/"],
    ["package_reference", "https://pkg.go.dev/"],
    ["security_advisory", "https://vuln.go.dev/"],
  ],
  java: [
    ["official_reference", "https://docs.oracle.com/en/java/"],
    ["package_reference", "https://central.sonatype.com/"],
    ["security_advisory", "https://osv.dev/"],
  ],
  kotlin: [
    ["official_reference", "https://kotlinlang.org/docs/home.html"],
    ["package_reference", "https://central.sonatype.com/"],
    ["security_advisory", "https://osv.dev/"],
  ],
  dotnet: [
    ["official_reference", "https://learn.microsoft.com/en-us/dotnet/"],
    ["package_reference", "https://www.nuget.org/"],
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
  return detectSoftwareTechnologies(input).map((detected) => {
    const adapters = TECHNOLOGY_ADAPTERS[detected.technology];
    const sources = SOURCE_CATALOG[detected.technology].map(([source_type, url]) => ({ source_type, url: canonicalUrl(url) }));
    const result = {
      schema_version: "technology_profile_v1",
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
      official_documentation_roots: sources.filter((item) => item.source_type === "official_reference"),
      package_registries: sources.filter((item) => item.source_type === "package_reference"),
      security_advisory_sources: sources.filter((item) => item.source_type === "security_advisory"),
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
  for (const item of technologies) for (const [source_type, url] of SOURCE_CATALOG[item.technology]) {
    selected.push({ technology: item.technology, source_type, url: canonicalUrl(url), primary: source_type === "official_reference" });
  }
  const allowedDomains = new Set(selected.map((item) => sourceDomain(item.url)));
  for (const value of input.additional_source_urls || []) {
    const url = canonicalUrl(value);
    const hostname = sourceDomain(url);
    if (![...allowedDomains].some((domain) => domainWithin(hostname, domain))) fail("software_research_source_domain_not_authorized");
    if (!selected.some((item) => item.url === url)) selected.push({ technology: "project_specific", source_type: "official_extension", url, primary: true });
  }
  const deduped = [...new Map(selected.map((item) => [item.url, item])).values()].slice(0, 20);
  const knowledgeGaps = [];
  if (!technologies.length) knowledgeGaps.push("technology_not_identified");
  if (!deduped.some((item) => item.primary)) knowledgeGaps.push("primary_source_missing");
  if (!deduped.some((item) => item.source_type === "security_advisory")) knowledgeGaps.push("security_advisory_source_missing");
  if (!input.version_context || !Object.keys(input.version_context).length) knowledgeGaps.push("version_context_not_observed");
  if (deduped.length < minimumSources) knowledgeGaps.push("insufficient_independent_sources");
  if (selected.length > 20) knowledgeGaps.push("source_budget_exhausted");
  const result = {
    schema_version: SOFTWARE_RESEARCH_SCHEMA_VERSION,
    tenant_id: boundedText(input.tenant_id, "tenant_id_required", 120),
    project_id: boundedText(input.project_id, "project_id_required", 160),
    work_id: boundedText(input.work_id, "work_id_required", 160),
    change_id: boundedText(input.change_id, "change_id_required", 160),
    plan_id: boundedText(input.plan_id, "plan_id_required", 160),
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
      exact_version_source_required: true,
      contradictions_open_blocking_challenge: true,
    },
    sources: deduped,
    knowledge_gaps: knowledgeGaps,
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

export function bindSoftwareResearchEvidence({ plan, capsule, verified = false, now = Date.now() } = {}) {
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
  if (plan.source_policy.primary_source_required && !observedSources.some((item) => item.primary)) fail("software_research_primary_source_missing");
  if (plan.source_policy.security_advisory_required && !observedSources.some((item) => item.source_type === "security_advisory")) fail("software_research_security_source_missing");
  if (!capsule.expires_at || Date.parse(capsule.expires_at) < Number(now)) fail("software_research_evidence_stale");
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
  const researchRequired = input.research_plan?.research_required === true;
  const researchReady = !researchRequired || (input.research_evidence?.verified === true
    && input.research_evidence.research_plan_digest === input.research_plan.research_plan_digest
    && Date.parse(input.research_evidence.fresh_until || "") >= Date.parse(input.issued_at));
  const technicalReady = input.research_plan?.technical_verification_required !== true || (input.technology_evidence?.verified === true
    && input.technology_evidence.research_plan_digest === input.research_plan.research_plan_digest
    && Date.parse(input.technology_evidence.fresh_until || "") >= Date.parse(input.issued_at));
  const securityCritical = input.research_plan?.risk_tier === "security_critical";
  const disposition = researchReady && technicalReady ? requestedDisposition : securityCritical ? "RECOMMEND_BLOCK" : "ABSTAIN";
  const result = {
    schema_version: NYRA_PRECORE_DECISION_SCHEMA_VERSION,
    tenant_id: boundedText(input.tenant_id, "tenant_id_required", 120),
    project_id: boundedText(input.project_id, "project_id_required", 160),
    work_id: boundedText(input.work_id, "work_id_required", 160),
    change_id: boundedText(input.change_id, "change_id_required", 160),
    plan_id: boundedText(input.plan_id, "plan_id_required", 160),
    state: "NYRA_PROVISIONAL",
    core_state: "CORE_PENDING",
    disposition,
    requested_disposition: requestedDisposition,
    recommendation: boundedText(input.recommendation, "nyra_precore_recommendation_required", 8_000),
    rationale: (input.rationale || []).map((item) => boundedText(item, "nyra_precore_rationale_invalid", 2_000)).slice(0, 50),
    uncertainties: [...new Set([...(input.uncertainties || []), ...(!researchReady ? ["technical_research_evidence_incomplete"] : []),
      ...(!technicalReady ? ["technology_adapter_evidence_incomplete"] : [])])].map((item) => String(item).slice(0, 500)).slice(0, 50),
    bindings: input.bindings,
    research_plan_digest: input.research_plan?.research_plan_digest || null,
    research_evidence_digest: researchReady ? input.research_evidence?.research_evidence_digest || null : null,
    technology_evidence_digest: technicalReady ? input.technology_evidence?.technology_evidence_digest || null : null,
    evidence_refs: [...new Set(input.evidence_refs || [])].sort(),
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
