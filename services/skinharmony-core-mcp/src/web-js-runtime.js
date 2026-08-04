import vm from "node:vm";

const MAX_SCRIPT_BYTES = 100_000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_RESULT_BYTES = 200_000;
const DEFAULT_TIMEOUT_MS = 2_000;

function bounded(value, max) {
  return String(value ?? "").slice(0, max);
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
}

function textFromHtml(html) {
  return decodeEntities(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function selectorText(html, selector) {
  const wanted = String(selector || "").trim();
  if (!wanted) return [];
  const tag = wanted.match(/^([a-zA-Z][a-zA-Z0-9-]*)$/)?.[1];
  const id = wanted.match(/^#([a-zA-Z0-9_-]+)$/)?.[1];
  const className = wanted.match(/^\.([a-zA-Z0-9_-]+)$/)?.[1];
  const pattern = tag
    ? new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi")
    : id
      ? new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "gi")
      : className
        ? new RegExp(`<([a-zA-Z][a-zA-Z0-9-]*)\\b[^>]*\\bclass=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "gi")
        : null;
  if (!pattern) return [];
  return [...String(html || "").matchAll(pattern)].slice(0, 500).map((match) => ({
    textContent: textFromHtml(match[tag ? 1 : 2] || match[1] || ""),
    innerHTML: bounded(match[tag ? 1 : 2] || match[1] || "", 20_000),
  }));
}

function createDocument(html, url, cookieState) {
  const document = {
    title: String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "",
    URL: url,
    querySelector(selector) {
      const item = selectorText(html, selector)[0];
      return item ? { ...item, getAttribute: () => null } : null;
    },
    querySelectorAll(selector) {
      return selectorText(html, selector);
    },
    getElementById(id) {
      return this.querySelector(`#${id}`);
    },
  };
  Object.defineProperty(document, "cookie", {
    get: () => [...cookieState.entries()].map(([key, value]) => `${key}=${value}`).join("; "),
    set: (value) => {
      const pair = String(value || "").split(";", 1)[0];
      const [key, ...rest] = pair.split("=");
      if (key && rest.length) cookieState.set(key.trim(), rest.join("=").trim());
    },
  });
  return document;
}

function jsonSafe(value) {
  if (value === undefined) return null;
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > MAX_RESULT_BYTES) return { truncated: true };
    return JSON.parse(serialized);
  } catch {
    return { type: typeof value, value: bounded(value, MAX_RESULT_BYTES) };
  }
}

export function createJavaScriptRuntime({ fetchImpl } = {}) {
  return {
    async execute({ script, html = "", url, cookie = "", timeoutMs = DEFAULT_TIMEOUT_MS }) {
      if (Buffer.byteLength(String(script || ""), "utf8") > MAX_SCRIPT_BYTES) {
        const error = new Error("web_javascript_too_large");
        error.code = "web_javascript_too_large";
        throw error;
      }
      const cookieState = new Map();
      for (const pair of String(cookie || "").split(";")) {
        const [key, ...rest] = pair.trim().split("=");
        if (key && rest.length) cookieState.set(key, rest.join("="));
      }
      const document = createDocument(bounded(html, MAX_HTML_BYTES), String(url || ""), cookieState);
      const fetch = async (input, init = {}) => {
        if (typeof fetchImpl !== "function") throw new Error("web_javascript_fetch_unavailable");
        const response = await fetchImpl(input, init);
        return {
          ok: response.status >= 200 && response.status < 400,
          status: response.status,
          url: response.url,
          headers: response.headers || {},
          text: async () => response.text,
          json: async () => JSON.parse(response.text),
        };
      };
      const logs = [];
      const context = vm.createContext({
        document,
        location: new URL(String(url || "about:blank")),
        window: { document, location: new URL(String(url || "about:blank")) },
        fetch,
        URL,
        console: { log: (...items) => logs.push(items.map((item) => bounded(item, 2_000)).join(" ")) },
        setTimeout,
        clearTimeout,
      });
      const source = `(async () => {\n${String(script || "")}\n})()`;
      let value;
      try {
        value = new vm.Script(source, { filename: "web-agent-script.js" }).runInContext(context, {
          timeout: Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 100), 10_000),
        });
        value = await Promise.race([
          value,
          new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("web_javascript_timeout"), { code: "web_javascript_timeout" })), Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 100), 10_000))),
        ]);
      } catch (error) {
        if (!error.code) error.code = "web_javascript_execution_failed";
        throw error;
      }
      return {
        value: jsonSafe(value),
        console: logs,
        document: { title: document.title, cookie: document.cookie, url: document.URL },
        runtime: { name: "node_vm_controlled", timeout_ms: Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 100), 10_000), script_bytes: Buffer.byteLength(String(script || ""), "utf8") },
      };
    },
  };
}
