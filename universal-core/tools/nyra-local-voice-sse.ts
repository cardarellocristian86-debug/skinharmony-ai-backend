import http from "node:http";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  buildNyraMetaPrompt,
  decideLocalNyra,
  extractSentenceChunks,
  planLocalNyraMeta,
  validateNyraMetaResponse,
  type NyraLocalDecision,
  type NyraLocalEvent,
} from "./nyra-local-voice-core.ts";
import {
  computeNyraCostVector,
  deriveNyraMathState,
  optimizeNyraMathState,
  rankNyraDecisionCandidates,
} from "./nyra-math-layer-v1.ts";
import {
  buildNyraLocalContext,
  learnNyraLocalMemory,
  loadNyraLocalMemory,
  saveNyraLocalMemory,
  updateNyraLocalShortMemory,
} from "./nyra-local-memory.ts";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const OLLAMA_MODEL = process.env.NYRA_OLLAMA_MODEL || "llama3";
const PIPER_MODEL = process.env.NYRA_PIPER_MODEL || "it_IT-medium.onnx";
const AUDIO_FILE = process.env.NYRA_PIPER_OUTPUT || "/tmp/nyra-local-out.wav";

type RunState = {
  ollama: ChildProcessWithoutNullStreams | null;
  piper: ChildProcessWithoutNullStreams[];
  interrupted: boolean;
};

const runState: RunState = {
  ollama: null,
  piper: [],
  interrupted: false,
};

const html = `<!DOCTYPE html>
<html>
<body>
<h2>Nyra Local SSE</h2>
<input id="input" style="width:420px" />
<button onclick="send()">Invia</button>
<button onclick="stopRun()">Stop</button>
<pre id="out"></pre>
<script>
function append(text) {
  document.getElementById("out").textContent += text;
}
function handleBlock(block) {
  if (!block.includes("event:") || !block.includes("data:")) return;
  const event = (block.match(/event: (.+)/) || [])[1];
  const dataText = (block.match(/data: (.+)/) || [])[1];
  if (!event || !dataText) return;
  const data = JSON.parse(dataText);
  if (event === "start") append("[start] " + data.decision + "\\n");
  if (event === "text") append(data.content);
  if (event === "sentence") append("\\n[speech] " + data.content + "\\n");
  if (event === "error") append("\\n[error] " + data.message + "\\n");
  if (event === "end") append("\\n[end]\\n");
}
function send() {
  document.getElementById("out").textContent = "";
  fetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: document.getElementById("input").value })
  }).then(async (res) => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const blocks = pending.split("\\n\\n");
      pending = blocks.pop() || "";
      blocks.forEach(handleBlock);
    }
    if (pending.trim()) handleBlock(pending);
  });
}
function stopRun() {
  fetch("/interrupt", { method: "POST" });
}
</script>
</body>
</html>`;

function sendSSE(res: http.ServerResponse, event: NyraLocalEvent["type"], data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function stopAllProcesses() {
  runState.interrupted = true;
  if (runState.ollama) {
    runState.ollama.kill();
    runState.ollama = null;
  }
  for (const proc of runState.piper) {
    proc.kill();
  }
  runState.piper = [];
  try {
    const afplay = spawn("pkill", ["-f", AUDIO_FILE]);
    afplay.on("error", () => {});
  } catch {}
}

function speakSentence(sentence: string) {
  const proc = spawn("piper", ["--model", PIPER_MODEL, "--output_file", AUDIO_FILE]);
  runState.piper.push(proc);
  proc.stdin.write(sentence);
  proc.stdin.end();
  proc.on("close", () => {
    runState.piper = runState.piper.filter((entry) => entry !== proc);
    if (!runState.interrupted) {
      const player = spawn("afplay", [AUDIO_FILE]);
      player.on("error", () => {});
    }
  });
  proc.on("error", () => {});
}

function streamOllama(
  prompt: string,
  onChunk: (chunk: string) => void,
  onEnd: () => void,
  onError: (message: string) => void,
) {
  const proc = spawn("ollama", ["run", OLLAMA_MODEL]);
  runState.ollama = proc;

  proc.stdin.write(prompt);
  proc.stdin.end();

  proc.stdout.on("data", (data) => {
    if (runState.interrupted) return;
    onChunk(data.toString());
  });
  proc.stderr.on("data", (data) => {
    if (runState.interrupted) return;
    onError(data.toString().trim() || "errore ollama");
  });
  proc.on("error", () => {
    onError("Ollama non disponibile");
  });
  proc.on("close", () => {
    runState.ollama = null;
    onEnd();
  });
}

function runAgent(decision: NyraLocalDecision, metaPrompt: string, res: http.ServerResponse) {
  runState.interrupted = false;
  sendSSE(res, "start", { decision: decision.intent });

  let sentenceTail = "";
  let finished = false;

  const flushEnd = () => {
    if (finished) return;
    finished = true;
    const finalSentence = sentenceTail.trim();
    if (finalSentence && !runState.interrupted) {
      speakSentence(finalSentence);
      sendSSE(res, "sentence", { content: finalSentence });
    }
    sendSSE(res, "end", {});
    res.end();
  };

  streamOllama(
    metaPrompt,
    (chunk) => {
      sendSSE(res, "text", { content: chunk });
      const parsed = extractSentenceChunks(sentenceTail + chunk);
      sentenceTail = parsed.rest;
      for (const sentence of parsed.ready) {
        if (runState.interrupted) break;
        speakSentence(sentence);
        sendSSE(res, "sentence", { content: sentence });
      }
    },
    flushEnd,
    (message) => {
      sendSSE(res, "error", { message });
      if (!finished) {
        finished = true;
        res.end();
      }
    },
  );
}

function buildPromptWithContext(decision: NyraLocalDecision, context: string): NyraLocalDecision {
  if (!context) {
    return decision;
  }
  return {
    ...decision,
    prompt: [
      "Contesto memoria Nyra:",
      context,
      "",
      decision.prompt,
    ].join("\n"),
  } as NyraLocalDecision;
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/chat") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { text } = JSON.parse(body) as { text?: string };
        const inputText = String(text || "");
        const memory = learnNyraLocalMemory(loadNyraLocalMemory(), inputText);
        saveNyraLocalMemory(memory);
        const initialContext = buildNyraLocalContext(memory);
        const decision = buildPromptWithContext(decideLocalNyra(inputText), initialContext);
        const metaPlan = planLocalNyraMeta(inputText, decision, memory.will);
        const mathState = deriveNyraMathState(memory.math_state, inputText, memory);
        const mathCost = computeNyraCostVector(mathState, decision, metaPlan);
        const candidates = rankNyraDecisionCandidates(mathState, decision, metaPlan);
        memory.math_state = optimizeNyraMathState(mathState, mathCost);
        saveNyraLocalMemory(memory);
        const memoryContext = buildNyraLocalContext(memory);
        const metaPrompt = buildNyraMetaPrompt(decision, memoryContext, metaPlan, inputText);
        const enrichedPrompt = [
          metaPrompt,
          "",
          `Layer matematico Nyra: stato=${JSON.stringify(mathState)}, costo=${JSON.stringify(mathCost)}, candidati=${JSON.stringify(candidates)}.`,
          "Usa questi segnali per stringere la risposta, ma il giudizio finale resta guidato dal Core e dai vincoli Nyra.",
        ].join("\n");
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const originalWrite = res.write.bind(res);
        const collectedParts: string[] = [];
        res.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void) => {
          const textChunk = typeof chunk === "string" ? chunk : chunk.toString();
          const eventBlocks = textChunk.split("\n\n");
          for (const block of eventBlocks) {
            const eventMatch = block.match(/event: ([^\n]+)/);
            const dataMatch = block.match(/data: ([\s\S]+)/);
            if (eventMatch?.[1] === "text" && dataMatch?.[1]) {
              try {
                const parsed = JSON.parse(dataMatch[1]) as { content?: string };
                if (parsed.content) {
                  collectedParts.push(String(parsed.content));
                }
              } catch {}
            }
          }
          return originalWrite(chunk as never, encoding as never, cb as never);
        }) as typeof res.write;
        res.on("close", () => {
          const collectedText = collectedParts.join("").trim();
          if (collectedText.trim() && validateNyraMetaResponse(collectedText, metaPlan)) {
            const updated = updateNyraLocalShortMemory(memory, inputText, collectedText.trim());
            saveNyraLocalMemory(updated);
          }
        });
        runAgent(decision, enrichedPrompt, res);
      } catch {
        res.writeHead(400);
        res.end("Bad request");
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/interrupt") {
    stopAllProcesses();
    res.writeHead(200);
    res.end("stopped");
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});

server.on("error", (error) => {
  console.error(error instanceof Error ? error.message : "server listen error");
});

server.listen(PORT, HOST, () => {
  console.log(`http://${HOST}:${PORT}`);
});
