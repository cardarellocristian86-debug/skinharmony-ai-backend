import { buildNyraRuntimeOverlayBundle } from "./nyra-branch-composer.ts";

type Payload = {
  text?: string;
  rootDir?: string;
};

function readPayload(): Payload {
  const raw = String(process.argv[2] || "").trim();
  if (!raw) return { text: "" };
  try {
    return JSON.parse(raw);
  } catch {
    return { text: raw };
  }
}

async function main() {
  const payload = readPayload();
  const text = String(payload.text || "").trim();
  const rootDir = payload.rootDir ? String(payload.rootDir) : process.cwd();
  const bundle = buildNyraRuntimeOverlayBundle(text, rootDir);
  process.stdout.write(JSON.stringify(bundle));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message);
  process.exit(1);
});
