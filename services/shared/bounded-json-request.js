const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_RESPONSE_LIMIT_BYTES = 512 * 1024;
const MAX_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;

const DEFAULT_ERROR_CODES = Object.freeze({
  timeout: "bounded_json_request_timeout",
  too_large: "bounded_json_response_too_large",
  invalid: "bounded_json_response_invalid",
  unavailable: "bounded_json_request_unavailable",
});

export class BoundedJsonRequestError extends Error {
  constructor(kind, code, status) {
    super(code);
    this.name = "BoundedJsonRequestError";
    this.kind = kind;
    this.code = code;
    this.status = status;
    this.statusCode = status;
  }
}

function boundedInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.trunc(parsed), maximum));
}

function errorFor(kind, codes) {
  const status = kind === "timeout" ? 504 : kind === "unavailable" ? 503 : 502;
  return new BoundedJsonRequestError(kind, codes[kind], status);
}

async function readJson(response, maximumBytes, codes, setReader) {
  const declaredValue = response?.headers?.get?.("content-length");
  if (declaredValue !== null && declaredValue !== undefined && declaredValue !== "") {
    if (!/^\d+$/.test(String(declaredValue))) throw errorFor("invalid", codes);
    const declaredBytes = Number(declaredValue);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maximumBytes) {
      throw errorFor("too_large", codes);
    }
  }

  let raw;
  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    setReader(reader);
    const chunks = [];
    let receivedBytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      const chunk = Buffer.from(part.value);
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maximumBytes) {
        void reader.cancel().catch(() => {});
        throw errorFor("too_large", codes);
      }
      chunks.push(chunk);
    }
    raw = Buffer.concat(chunks, receivedBytes).toString("utf8");
  } else if (typeof response?.arrayBuffer === "function") {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw errorFor("too_large", codes);
    raw = bytes.toString("utf8");
  } else if (typeof response?.json === "function") {
    // Deterministic unit-test transports may expose only json(). Production
    // fetch responses always take one of the byte-bounded branches above.
    let payload;
    try {
      payload = await response.json();
      raw = JSON.stringify(payload);
    } catch {
      throw errorFor("invalid", codes);
    }
    if (Buffer.byteLength(raw, "utf8") > maximumBytes) throw errorFor("too_large", codes);
    return payload;
  } else {
    throw errorFor("invalid", codes);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw errorFor("invalid", codes);
  }
}

/**
 * Execute exactly one JSON HTTP request with a finite wall-clock deadline and
 * a byte cap. This helper deliberately performs no retry: callers decide how
 * to reconcile a mutation whose remote outcome cannot be proven.
 */
export async function boundedJsonRequest(url, init = {}, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_RESPONSE_LIMIT_BYTES,
  errorCodes = DEFAULT_ERROR_CODES,
} = {}) {
  if (typeof fetchImpl !== "function") throw errorFor("unavailable", DEFAULT_ERROR_CODES);
  const codes = Object.freeze({ ...DEFAULT_ERROR_CODES, ...(errorCodes || {}) });
  const deadlineMs = boundedInteger(timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const maximumBytes = boundedInteger(
    maxResponseBytes,
    DEFAULT_RESPONSE_LIMIT_BYTES,
    MAX_RESPONSE_LIMIT_BYTES,
  );
  const controller = new AbortController();
  let reader = null;
  let timer;

  const operation = (async () => {
    const response = await fetchImpl(url, {
      ...init,
      redirect: init.redirect || "error",
      signal: controller.signal,
    });
    if (!response || typeof response.ok !== "boolean") throw errorFor("invalid", codes);
    const payload = await readJson(response, maximumBytes, codes, (value) => { reader = value; });
    return { response, payload };
  })();
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      reject(errorFor("timeout", codes));
    }, deadlineMs);
  });

  try {
    return await Promise.race([operation, deadline]);
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      throw error;
    }
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
    if (error?.name === "AbortError") throw errorFor("timeout", codes);
    throw errorFor("unavailable", codes);
  } finally {
    clearTimeout(timer);
  }
}
