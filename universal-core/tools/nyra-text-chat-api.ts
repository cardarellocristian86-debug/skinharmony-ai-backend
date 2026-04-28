import { runNyraTextChatTurn } from "./nyra-text-chat-runner.ts";

async function main() {
  const payload = process.argv[2] ? JSON.parse(process.argv[2]) as {
    text?: string;
    sessionId?: string;
  } : {};

  const text = String(payload.text || "").trim();
  if (!text) {
    console.log(JSON.stringify({
      ok: false,
      error: "Messaggio mancante.",
    }));
    return;
  }

  const result = await runNyraTextChatTurn(text, payload.sessionId || "nyra-render-text-sandbox");
  console.log(JSON.stringify({
    ok: true,
    result,
  }));
}

main().catch((error) => {
  console.log(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "Errore Nyra text sandbox.",
  }));
  process.exitCode = 1;
});
