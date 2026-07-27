const DEFAULT_MAX_BYTES = 64 * 1024;

export class McpStagingBoundedJsonResponseError extends Error {
  constructor(code) {
    super(code);
    this.name = "McpStagingBoundedJsonResponseError";
    this.code = code;
  }
}

function fail(code) {
  throw new McpStagingBoundedJsonResponseError(code);
}

function validOptions(maxBytes, signal) {
  return Number.isInteger(maxBytes) && maxBytes >= 1 && maxBytes <= DEFAULT_MAX_BYTES &&
    (signal === undefined || signal === null ||
      (typeof signal === "object" && typeof signal.addEventListener === "function" &&
        typeof signal.removeEventListener === "function" && typeof signal.aborted === "boolean"));
}

function declaredLength(headers, maxBytes) {
  if (!headers || typeof headers.get !== "function") return;
  let value;
  try {
    value = headers.get("content-length");
  } catch {
    fail("bounded_json_response_invalid");
  }
  if (value === null) return;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) fail("bounded_json_response_invalid");
  const length = Number(value);
  if (!Number.isSafeInteger(length)) fail("bounded_json_response_invalid");
  if (length > maxBytes) fail("bounded_json_response_too_large");
}

function joinChunks(chunks, totalBytes) {
  const joined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

export async function readMcpStagingBoundedJsonResponse(response, {
  maxBytes = DEFAULT_MAX_BYTES,
  signal,
} = {}) {
  if (!validOptions(maxBytes, signal) || !response || typeof response !== "object") {
    fail("bounded_json_response_invalid");
  }
  let status;
  let body;
  let headers;
  try {
    status = response.status;
    body = response.body;
    headers = response.headers;
  } catch {
    fail("bounded_json_response_invalid");
  }
  if (!Number.isInteger(status) || status < 100 || status > 599 ||
      !body || typeof body.getReader !== "function") {
    fail("bounded_json_response_invalid");
  }
  let reader;
  try {
    reader = body.getReader();
  } catch {
    fail("bounded_json_response_invalid");
  }
  try {
    declaredLength(headers, maxBytes);
  } catch (error) {
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* Redacted provider cleanup. */ }
    throw error;
  }

  let aborted = false;
  let rejectAbort;
  const abortFailure = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    aborted = true;
    rejectAbort(new McpStagingBoundedJsonResponseError("bounded_json_response_aborted"));
    try {
      Promise.resolve(reader.cancel()).catch(() => {});
    } catch {
      // Provider errors are intentionally discarded.
    }
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  let complete = false;
  try {
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      let part;
      try {
        part = signal
          ? await Promise.race([reader.read(), abortFailure])
          : await reader.read();
      } catch (error) {
        if (error instanceof McpStagingBoundedJsonResponseError) throw error;
        fail(aborted || signal?.aborted
          ? "bounded_json_response_aborted"
          : "bounded_json_response_invalid");
      }
      if (!part || typeof part !== "object" || typeof part.done !== "boolean") {
        fail("bounded_json_response_invalid");
      }
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || part.value.byteLength === 0) {
        fail("bounded_json_response_invalid");
      }
      totalBytes += part.value.byteLength;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBytes) {
        fail("bounded_json_response_too_large");
      }
      chunks.push(part.value);
    }

    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(joinChunks(chunks, totalBytes));
    } catch {
      fail("bounded_json_response_invalid");
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      fail("bounded_json_response_invalid");
    }
    complete = true;
    return value;
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    if (complete) {
      try { reader.releaseLock(); } catch { /* No response details escape. */ }
    } else {
      try {
        Promise.resolve(reader.cancel()).catch(() => {});
      } catch {
        // Provider errors are intentionally discarded.
      }
    }
  }
}

export const mcpStagingBoundedJsonResponseContract = Object.freeze({
  max_bytes: DEFAULT_MAX_BYTES,
});
