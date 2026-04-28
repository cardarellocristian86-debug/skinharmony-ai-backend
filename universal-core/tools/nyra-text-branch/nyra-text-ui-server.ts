import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNyraTextBranch } from "./nyra-text-runtime.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UI_DIR = path.join(__dirname, "ui");
const PORT = Number(process.env.NYRA_TEXT_UI_PORT || 4387);
const HOST = process.env.NYRA_TEXT_UI_HOST || "127.0.0.1";

function sendJson(res: http.ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendFile(res: http.ServerResponse, filePath: string, type: string) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString();
      if (data.length > 1_000_000) {
        reject(new Error("Payload troppo grande."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "GET" && url.pathname === "/") {
    sendFile(res, path.join(UI_DIR, "index.html"), "text/html; charset=utf-8");
    return;
  }

  if (req.method === "GET" && url.pathname === "/app.css") {
    sendFile(res, path.join(UI_DIR, "app.css"), "text/css; charset=utf-8");
    return;
  }

  if (req.method === "GET" && url.pathname === "/app.js") {
    sendFile(res, path.join(UI_DIR, "app.js"), "application/javascript; charset=utf-8");
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ping") {
    sendJson(res, 200, {
      ok: true,
      mode: "nyra-text-branch-ui",
      host: HOST,
      port: PORT,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) as { text?: string; ownerId?: string; sessionId?: string } : {};
      const text = String(body.text || "").trim();

      if (!text) {
        sendJson(res, 400, { error: "Messaggio vuoto." });
        return;
      }

      const result = await runNyraTextBranch({
        ownerId: body.ownerId || "ui-user",
        text,
        sessionId: body.sessionId,
      });

      sendJson(res, 200, result);
      return;
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Errore interno.",
      });
      return;
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, HOST, () => {
  console.log(`Nyra text UI attiva su http://${HOST}:${PORT}`);
});
