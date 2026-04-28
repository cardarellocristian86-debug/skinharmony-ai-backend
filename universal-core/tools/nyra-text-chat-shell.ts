import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runNyraTextChatTurn } from "./nyra-text-chat-runner.ts";

async function main() {
  const rl = createInterface({ input, output });

  console.log("");
  console.log("Nyra attiva.");
  console.log("Modalita: text-branch isolato su chat testuale locale.");
  console.log("Core: override locali forti + fallback al cervello ricco quando serve.");
  console.log("Comandi: :help | :memory | :forget | :learn chiave=valore | :exit");
  console.log("");

  while (true) {
    const raw = await rl.question("Tu: ");
    const text = raw.trim();

    if (!text) continue;

    if (text.toLowerCase() === ":exit") {
      console.log("Nyra: Connessione chiusa.");
      console.log("");
      break;
    }

    try {
      const result = await runNyraTextChatTurn(text);
      console.log(`Nyra: ${result.content}`);
      console.log("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "errore sconosciuto";
      console.log(`Nyra errore: ${message}`);
      console.log("");
    }
  }

  rl.close();
}

main().catch((error) => {
  console.error("Errore fatale Nyra text chat:", error);
  process.exit(1);
});
