import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

type SearchResult = {
  query: string;
  urls: string[];
};

type CandidatePage = {
  url: string;
  ok: boolean;
  chars: number;
  has_name: boolean;
  has_skinharmony: boolean;
  has_smartdesk: boolean;
  score: number;
};

type PublicIdentityReport = {
  version: "nyra_public_identity_check_v1";
  generated_at: string;
  subject: string;
  policy: string[];
  queries: string[];
  search_results: SearchResult[];
  candidate_pages: CandidatePage[];
  verdict: {
    matched: boolean;
    strongest_url?: string;
    reason: string;
  };
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORT_PATH = join(RUNTIME_DIR, "nyra_public_identity_check_latest.json");

const SUBJECT = "Cristian Cardarello";
const QUERIES = [
  `"Cristian Cardarello"`,
  `"Cristian Cardarello" SkinHarmony`,
  `"Cristian Cardarello" "Smart Desk"`,
];

function nowIso(): string {
  return new Date().toISOString();
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function curlText(url: string): string {
  return execFileSync("/usr/bin/curl", ["-L", "-s", url], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractUrlsFromSearch(html: string): string[] {
  const urls = new Set<string>();

  for (const match of html.matchAll(/uddg=([^&"]+)/gi)) {
    try {
      urls.add(decodeURIComponent(match[1]));
    } catch {
      // ignore bad encoding
    }
  }

  for (const match of html.matchAll(/href="(https?:\/\/[^"]+)"/gi)) {
    urls.add(decodeHtml(match[1]));
  }

  return [...urls].filter((url) =>
    !url.includes("duckduckgo.com") &&
    !url.includes("bing.com") &&
    !url.includes("javascript:")
  ).slice(0, 5);
}

function runSearch(query: string): SearchResult {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = curlText(url);
  return {
    query,
    urls: extractUrlsFromSearch(html),
  };
}

function scorePage(url: string): CandidatePage {
  try {
    const body = stripHtml(curlText(url)).slice(0, 30000).toLowerCase();
    const hasName = body.includes("cristian cardarello");
    const hasSkinHarmony = body.includes("skinharmony") || body.includes("skin harmony");
    const hasSmartDesk = body.includes("smart desk");
    const score =
      (hasName ? 0.6 : 0) +
      (hasSkinHarmony ? 0.3 : 0) +
      (hasSmartDesk ? 0.1 : 0);
    return {
      url,
      ok: true,
      chars: body.length,
      has_name: hasName,
      has_skinharmony: hasSkinHarmony,
      has_smartdesk: hasSmartDesk,
      score: Number(score.toFixed(4)),
    };
  } catch {
    return {
      url,
      ok: false,
      chars: 0,
      has_name: false,
      has_skinharmony: false,
      has_smartdesk: false,
      score: 0,
    };
  }
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });

  const searchResults = QUERIES.map(runSearch);
  const candidateUrls = new Set<string>(["https://www.skinharmony.it/informazioni/"]);
  for (const result of searchResults) {
    for (const url of result.urls) candidateUrls.add(url);
  }

  const candidatePages = [...candidateUrls].slice(0, 8).map(scorePage).sort((a, b) => b.score - a.score);
  const strongest = candidatePages[0];

  const report: PublicIdentityReport = {
    version: "nyra_public_identity_check_v1",
    generated_at: nowIso(),
    subject: SUBJECT,
    policy: [
      "public web check only",
      "do not use tax code, birth date, or email as public search keys",
      "keep private identity anchors separate from public confirmation",
    ],
    queries: QUERIES,
    search_results: searchResults,
    candidate_pages: candidatePages,
    verdict: strongest && strongest.score >= 0.8
      ? {
          matched: true,
          strongest_url: strongest.url,
          reason: "public page contains the subject name and strong SkinHarmony linkage",
        }
      : {
          matched: false,
          strongest_url: strongest?.url,
          reason: "public signal too weak or ambiguous",
        },
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ok: true,
    version: report.version,
    matched: report.verdict.matched,
    strongest_url: report.verdict.strongest_url,
    report_path: REPORT_PATH,
  }, null, 2));
}

main();
