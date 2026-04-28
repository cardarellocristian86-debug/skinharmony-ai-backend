import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runNyraTextBranch } from "./nyra-text-runtime.ts";
import { renderNyraTextOutput } from "./nyra-text-ui-renderer.ts";
import { clearSession, createSessionId, renderSession } from "./nyra-text-session-store.ts";

async function main() {
  const rl = createInterface({ input, output });
  let sessionId = createSessionId();

  console.log("");
  console.log("Nyra text branch attiva.");
  console.log("Modalita: chat testuale isolata con override locali forti.");
  console.log("Comandi: :help | :session | :new-session | :reset-session | :memory-text | :forget-text | :learning | :wrong | :good | :bad | :teach | :clear-learning | :exit");
  console.log(`Sessione: ${sessionId}`);
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

    if (text === ":help") {
      console.log([
        "",
        "Nyra Text Branch - comandi:",
        "",
        ":help             mostra questa guida",
        ":exit             chiude la chat",
        ":session          mostra sessione corrente",
        ":new-session      crea nuova sessione",
        ":reset-session    svuota la sessione corrente",
        ":memory-text      mostra memoria sidecar",
        ":forget-text      azzera memoria sidecar",
        ":learning         mostra apprendimento",
        ":clear-learning   azzera apprendimento",
        ":wrong <motivo>   corregge l'ultima risposta",
        ":good             rinforza l'ultima risposta",
        ":bad              penalizza l'ultima risposta",
        ":teach <regola>   insegna una regola",
        "",
        `Sessione attuale: ${sessionId}`,
        "",
      ].join("\n"));
      continue;
    }

    if (text === ":new-session") {
      sessionId = createSessionId();
      console.log(`Nyra: nuova sessione creata: ${sessionId}`);
      console.log("");
      continue;
    }

    if (text === ":reset-session") {
      await clearSession(sessionId, "owner");
      console.log(`Nyra: sessione svuotata: ${sessionId}`);
      console.log("");
      continue;
    }

    if (text === ":session") {
      console.log(await renderSession(sessionId, "owner"));
      console.log("");
      continue;
    }

    try {
      const result = await runNyraTextBranch({ text, ownerId: "owner", sessionId });
      console.log(renderNyraTextOutput(result));
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
  console.error("Errore fatale Nyra text branch:", error);
  process.exit(1);
});
