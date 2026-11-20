// Small, incremental Server-Sent Events reader shared by the agent client and
// provider adapters. Handles UTF-8 code points split across network chunks.
export async function readSse(body, { signal, onEvent } = {}) {
  if (!body?.getReader) throw new TypeError("SSE response has no readable body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines = [];
  const events = [];

  const dispatch = () => {
    if (!dataLines.length) { eventName = "message"; return; }
    const event = { event: eventName, data: dataLines.join("\n") };
    dataLines = [];
    eventName = "message";
    events.push(event);
    if (typeof onEvent === "function") onEvent(event);
  };
  const consumeLines = (final = false) => {
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line) { dispatch(); continue; }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") eventName = value || "message";
      else if (field === "data") dataLines.push(value);
    }
    if (final && buffer) {
      const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
      buffer = "";
      if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      else if (line.startsWith("event:")) eventName = line.slice(6).replace(/^ /, "") || "message";
    }
  };

  try {
    while (true) {
      if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      consumeLines(done);
      if (done) { dispatch(); break; }
    }
  } catch (error) {
    try { await reader.cancel(error); } catch { /* already closed */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
  return events;
}
