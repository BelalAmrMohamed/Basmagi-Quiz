// Scripted `fetch` stub for the AI agent loop tests.
// Each scripted step is either a plain object ({ text, thinking, toolCalls }),
// a function (body) => object | { status, body }, or { status, body } for errors.
// The stub records every request body in `requests`.

export function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
  };
}

export function installFakeChat(steps) {
  const original = globalThis.fetch;
  const requests = [];
  let i = 0;
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    requests.push({ url: String(url), body, headers: init.headers, signal: init.signal });
    if (init.signal?.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    const resolved = typeof step === "function" ? await step(body, i - 1) : step;
    if (resolved && typeof resolved.status === "number" && "body" in resolved) {
      return jsonResponse(resolved.body, resolved.status);
    }
    return jsonResponse(resolved || {});
  };
  return {
    requests,
    get calls() {
      return i;
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

export const apiUrl = (p) => p;
