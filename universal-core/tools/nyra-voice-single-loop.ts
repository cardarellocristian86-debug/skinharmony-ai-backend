import http from "node:http";
import OpenAI from "openai";
import { WebSocketServer } from "ws";
import {
  buildVoiceToolSpecs,
  explainSmartDeskRole,
  extractReadySpeechChunks,
  rankCashTargets,
  type NyraVoiceEvent,
} from "./nyra-voice-single-loop-core.ts";

const MODEL = process.env.NYRA_VOICE_MODEL || "gpt-4o-mini";
const TTS_MODEL = process.env.NYRA_TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.NYRA_TTS_VOICE || "alloy";
const PORT = Number(process.env.PORT || 3099);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Nyra Voice Loop</title>
  <style>
    body { font-family: Georgia, serif; max-width: 880px; margin: 32px auto; padding: 0 16px; }
    textarea { width: 100%; min-height: 120px; }
    pre { white-space: pre-wrap; background: #f6f6f6; padding: 16px; border-radius: 12px; min-height: 180px; }
    .row { display: flex; gap: 12px; margin: 12px 0; }
    button { padding: 10px 16px; }
  </style>
</head>
<body>
  <h2>Nyra Single Loop v1</h2>
  <textarea id="input" placeholder="Scrivi o detta qui..."></textarea>
  <div class="row">
    <button onclick="sendMessage()">Invia</button>
    <button onclick="interruptRun()">Interrompi</button>
  </div>
  <pre id="output"></pre>
  <script>
    const ws = new WebSocket("ws://" + location.host);
    const output = document.getElementById("output");
    let currentAudio = Promise.resolve();

    function append(line) {
      output.textContent += line;
    }

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "state") append("\\n[state] " + data.phase + "\\n");
      if (data.type === "text") append(data.content);
      if (data.type === "tool_call") append("\\n[tool] " + data.name + " " + JSON.stringify(data.args) + "\\n");
      if (data.type === "tool_result") append("[tool_result] " + data.name + " " + JSON.stringify(data.result) + "\\n");
      if (data.type === "error") append("\\n[error] " + data.message + "\\n");
      if (data.type === "audio_chunk") {
        currentAudio = currentAudio.then(() => {
          const audio = new Audio("data:audio/mp3;base64," + data.audio_base64);
          return audio.play().catch(() => {});
        });
      }
      if (data.type === "end") append("\\n[end]\\n");
    };

    function sendMessage() {
      output.textContent = "";
      ws.send(JSON.stringify({ type: "message", text: document.getElementById("input").value }));
    }

    function interruptRun() {
      ws.send(JSON.stringify({ type: "interrupt" }));
    }
  </script>
</body>
</html>`;

function sendEvent(ws: import("ws").WebSocket, event: NyraVoiceEvent) {
  ws.send(JSON.stringify(event));
}

function buildToolDefinitions() {
  return buildVoiceToolSpecs().map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function executeTool(name: string, args: Record<string, unknown>) {
  if (name === "nyra_rank_cash_targets") {
    return rankCashTargets(String(args.urgency || "mixed"), String(args.sector_hint || ""));
  }
  if (name === "nyra_explain_smartdesk_role") {
    return explainSmartDeskRole(String(args.focus || "general"));
  }
  throw new Error(`Tool non supportato: ${name}`);
}

async function emitSpeechChunks(ws: import("ws").WebSocket, runId: string, textBuffer: { current: string }) {
  const { ready, rest } = extractReadySpeechChunks(textBuffer.current);
  textBuffer.current = rest;
  for (const sentence of ready) {
    const audio = await openai.audio.speech.create({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: sentence,
    });
    const buffer = Buffer.from(await audio.arrayBuffer());
    sendEvent(ws, { type: "audio_chunk", run_id: runId, text: sentence, audio_base64: buffer.toString("base64") });
  }
}

async function runSingleLoop(
  ws: import("ws").WebSocket,
  runId: string,
  inputText: string,
  isActive: () => boolean,
) {
  const tools = buildToolDefinitions();
  const messages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content: [
        "Sei Nyra. Devi decidere mentre parli.",
        "Non inventare dati o azioni non supportate dagli strumenti.",
        "Quando serve usa i tool inline, poi continua la risposta nello stesso flusso.",
        "Parla in italiano chiaro, concreto, vivo.",
      ].join(" "),
    },
    { role: "user", content: inputText },
  ];

  const speechBuffer = { current: "" };

  while (isActive()) {
    sendEvent(ws, { type: "state", phase: "thinking", run_id: runId });
    const stream = await openai.chat.completions.create({
      model: MODEL,
      stream: true,
      messages,
      tools,
      tool_choice: "auto",
    });

    const toolCalls = new Map<number, { id: string; name: string; argumentsText: string }>();
    let sawToolCall = false;

    for await (const part of stream) {
      if (!isActive()) {
        sendEvent(ws, { type: "state", phase: "interrupted", run_id: runId });
        return;
      }
      const delta = part.choices[0]?.delta;
      const content = delta?.content;
      if (content) {
        sendEvent(ws, { type: "state", phase: "speaking", run_id: runId });
        sendEvent(ws, { type: "text", run_id: runId, content });
        speechBuffer.current += content;
        await emitSpeechChunks(ws, runId, speechBuffer);
      }
      for (const toolCall of delta?.tool_calls || []) {
        sawToolCall = true;
        const index = Number(toolCall.index || 0);
        const current = toolCalls.get(index) || {
          id: toolCall.id || `tool_${index}`,
          name: toolCall.function?.name || "",
          argumentsText: "",
        };
        if (toolCall.id) current.id = toolCall.id;
        if (toolCall.function?.name) current.name = toolCall.function.name;
        if (toolCall.function?.arguments) current.argumentsText += toolCall.function.arguments;
        toolCalls.set(index, current);
      }
    }

    if (!sawToolCall) {
      if (speechBuffer.current.trim()) {
        const sentence = speechBuffer.current.trim();
        speechBuffer.current = "";
        const audio = await openai.audio.speech.create({
          model: TTS_MODEL,
          voice: TTS_VOICE,
          input: sentence,
        });
        const buffer = Buffer.from(await audio.arrayBuffer());
        sendEvent(ws, { type: "audio_chunk", run_id: runId, text: sentence, audio_base64: buffer.toString("base64") });
      }
      sendEvent(ws, { type: "state", phase: "completed", run_id: runId });
      sendEvent(ws, { type: "end", run_id: runId });
      return;
    }

    const assistantToolCalls = [];
    const pendingToolResults = [];
    for (const toolCall of toolCalls.values()) {
      const parsedArgs = toolCall.argumentsText.trim() ? JSON.parse(toolCall.argumentsText) : {};
      sendEvent(ws, { type: "state", phase: "tool_running", run_id: runId });
      sendEvent(ws, { type: "tool_call", run_id: runId, name: toolCall.name, args: parsedArgs });
      const result = executeTool(toolCall.name, parsedArgs);
      sendEvent(ws, { type: "tool_result", run_id: runId, name: toolCall.name, result });
      assistantToolCalls.push({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(parsedArgs),
        },
      });
      pendingToolResults.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: assistantToolCalls,
    });
    messages.push(...pendingToolResults);
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  let activeRunId = "";

  ws.on("message", async (raw) => {
    const data = JSON.parse(raw.toString()) as { type: string; text?: string };
    if (data.type === "interrupt") {
      activeRunId = "";
      return;
    }
    if (data.type !== "message" || !data.text?.trim()) return;

    const runId = `run_${Date.now()}`;
    activeRunId = runId;
    sendEvent(ws, { type: "state", phase: "listening", run_id: runId });

    try {
      await runSingleLoop(ws, runId, data.text, () => activeRunId === runId);
    } catch (error) {
      sendEvent(ws, {
        type: "error",
        run_id: runId,
        message: error instanceof Error ? error.message : "Errore sconosciuto nel loop Nyra",
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
