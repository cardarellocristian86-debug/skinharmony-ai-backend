import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

type NyraWebAccessState = {
  access_mode: "restricted" | "free_explore";
  trigger_mode?: "manual" | "on_need";
  granted_at?: string;
  last_explored_at?: string;
  last_distilled_at?: string;
  source_config?: string;
  note?: string;
};

type SourceConfig = {
  version: string;
  generated_at?: string;
  domains: Array<{
    id: string;
    sources: string[];
  }>;
};

type ExploreDomainReport = {
  id: string;
  seed_count: number;
  discovered_count: number;
  merged_count: number;
  discovered_urls: string[];
};

type ExploreReport = {
  version: "nyra_web_explore_v2";
  generated_at: string;
  mode: "guided_navigation";
  selected_domains: string[];
  runtime_config_path: string;
  report_path: string;
  domains: ExploreDomainReport[];
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const STATE_PATH = join(RUNTIME_DIR, "nyra_web_access_state.json");
const REPORT_PATH = join(RUNTIME_DIR, "nyra_web_explore_latest.json");
const SOURCE_CONFIG = join(ROOT, "universal-core", "config", "nyra_web_study_sources_v2.json");
const RUNTIME_CONFIG = join(RUNTIME_DIR, "nyra_web_study_sources_runtime_latest.json");

const MAX_DISCOVERED_PER_DOMAIN = 6;
const MAX_DISCOVERED_PER_SEED = 2;

function loadState(): NyraWebAccessState {
  if (!existsSync(STATE_PATH)) {
    return {
      access_mode: "restricted",
      trigger_mode: "manual",
      source_config: SOURCE_CONFIG,
      note: "runner separato dal profilo owner-only",
    };
  }
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as NyraWebAccessState;
}

function loadConfig(): SourceConfig {
  return JSON.parse(readFileSync(SOURCE_CONFIG, "utf8")) as SourceConfig;
}

function saveState(state: NyraWebAccessState): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function fetchHtml(url: string): string {
  return execFileSync("/usr/bin/curl", ["-L", "-s", url], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function normalizeCandidate(baseUrl: string, href: string): string | undefined {
  try {
    const url = new URL(href, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function isUsefulDocLink(base: URL, candidate: URL): boolean {
  if (candidate.host !== base.host) return false;
  const lower = candidate.pathname.toLowerCase();
  if (
    !lower ||
    lower === "/" ||
    lower.includes("%7b%7b") ||
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".svg") ||
    lower.endsWith(".css") ||
    lower.endsWith(".js")
  ) {
    return false;
  }
  if (lower.includes("/search") || lower.includes("/tag/") || lower.includes("/tags/")) return false;
  if (lower.includes("privacy-and-terms-of-use") || lower.includes("/privacy") || lower.includes("/terms")) return false;
  return (
    lower.includes("/entries/") ||
    lower.includes("/guide") ||
    lower.includes("/guidance/") ||
    lower.includes("/docs") ||
    lower.includes("/doc") ||
    lower.includes("/writing") ||
    lower.includes("/pages/") ||
    lower.includes("/courses/") ||
    lower.includes("/articles/") ||
    lower.includes("/essays") ||
    lower.includes("/handbook") ||
    lower.includes("/book") ||
    lower.includes("/owl/")
  );
}

function extractLinks(baseUrl: string, html: string): string[] {
  const base = new URL(baseUrl);
  const hrefs = [...html.matchAll(/href=["']([^"'#]+)["']/gi)]
    .map((match) => match[1])
    .filter((href): href is string => Boolean(href));

  const seen = new Set<string>();
  const links: string[] = [];
  for (const href of hrefs) {
    const normalized = normalizeCandidate(baseUrl, href);
    if (!normalized || seen.has(normalized)) continue;
    const candidate = new URL(normalized);
    if (!isUsefulDocLink(base, candidate)) continue;
    seen.add(normalized);
    links.push(normalized);
  }
  return links;
}

function discoverForSeed(seedUrl: string): string[] {
  try {
    const html = fetchHtml(seedUrl);
    return extractLinks(seedUrl, html).slice(0, MAX_DISCOVERED_PER_SEED);
  } catch {
    return [];
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function buildRuntimeConfig(config: SourceConfig, selectedIds: string[]): { runtimeConfig: SourceConfig; report: ExploreReport } {
  const domains = config.domains
    .filter((domain) => selectedIds.length === 0 || selectedIds.includes(domain.id))
    .map((domain) => {
      const discovered = unique(
        domain.sources.flatMap((seedUrl) => discoverForSeed(seedUrl)).slice(0, MAX_DISCOVERED_PER_DOMAIN),
      );
      const merged = unique([...domain.sources, ...discovered]);
      return {
        id: domain.id,
        sources: merged,
        _meta: {
          seed_count: domain.sources.length,
          discovered_count: discovered.length,
          merged_count: merged.length,
          discovered_urls: discovered,
        },
      };
    });

  const runtimeConfig: SourceConfig = {
    version: "nyra_web_study_sources_runtime_v1",
    generated_at: new Date().toISOString(),
    domains: domains.map((domain) => ({ id: domain.id, sources: domain.sources })),
  };

  const report: ExploreReport = {
    version: "nyra_web_explore_v2",
    generated_at: runtimeConfig.generated_at!,
    mode: "guided_navigation",
    selected_domains: domains.map((domain) => domain.id),
    runtime_config_path: RUNTIME_CONFIG,
    report_path: REPORT_PATH,
    domains: domains.map((domain) => ({
      id: domain.id,
      seed_count: domain._meta.seed_count,
      discovered_count: domain._meta.discovered_count,
      merged_count: domain._meta.merged_count,
      discovered_urls: domain._meta.discovered_urls,
    })),
  };

  return { runtimeConfig, report };
}

function parseRequestedDomains(argv: string[]): string[] {
  const args = argv.map((item) => item.toLowerCase()).filter(Boolean);
  if (!args.length || args.includes("auto") || args.includes("all")) return [];
  return args;
}

function main(): void {
  const state = loadState();
  if (state.access_mode !== "free_explore") {
    console.log(
      JSON.stringify(
        {
          ok: false,
          reason: "web_access_not_granted",
          state_path: STATE_PATH,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  mkdirSync(RUNTIME_DIR, { recursive: true });
  const requestedDomains = parseRequestedDomains(process.argv.slice(2));
  const { runtimeConfig, report } = buildRuntimeConfig(loadConfig(), requestedDomains);
  writeFileSync(RUNTIME_CONFIG, JSON.stringify(runtimeConfig, null, 2));
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  execFileSync(
    process.execPath,
    ["--experimental-strip-types", "tools/nyra-advanced-study.ts", "--config", RUNTIME_CONFIG, "all"],
    {
      cwd: process.cwd(),
      stdio: "inherit",
    },
  );
  execFileSync(process.execPath, ["--experimental-strip-types", "tools/nyra-advanced-study-distill.ts"], {
    cwd: process.cwd(),
    stdio: "inherit",
  });

  const now = new Date().toISOString();
  const updatedState: NyraWebAccessState = {
    ...state,
    last_explored_at: now,
    last_distilled_at: now,
    source_config: RUNTIME_CONFIG,
  };
  saveState(updatedState);

  console.log(
    JSON.stringify(
      {
        ok: true,
        access_mode: updatedState.access_mode,
        last_explored_at: updatedState.last_explored_at,
        last_distilled_at: updatedState.last_distilled_at,
        runtime_config_path: RUNTIME_CONFIG,
        report_path: REPORT_PATH,
        state_path: STATE_PATH,
      },
      null,
      2,
    ),
  );
}

main();
