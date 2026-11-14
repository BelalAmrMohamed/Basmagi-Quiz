// Runs an unmodified Vercel-style `(req, res)` handler inside a Supabase Edge
// Function (Deno). Only the subset of the Node API that api/*.js actually uses:
//   req: method, headers (lowercased), url, query, body (JSON-parsed), socket.remoteAddress
//   res: status/statusCode, setHeader/getHeader/removeHeader, json, send, end, write, writeHead
type Handler = (req: any, res: any) => unknown | Promise<unknown>;

const NO_BODY = new Set([101, 204, 205, 304]);

function parseQuery(params: URLSearchParams) {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of params) {
    if (k in out) out[k] = ([] as string[]).concat(out[k], v);
    else out[k] = v;
  }
  return out;
}

export function serveNode(handler: Handler) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));

    let body: unknown = undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const raw = await request.text();
      if (raw) {
        const ct = headers["content-type"] || "";
        if (ct.includes("json") || ct.includes("text/plain")) {
          try { body = JSON.parse(raw); } catch { body = raw; }
        } else if (ct.includes("x-www-form-urlencoded")) {
          body = Object.fromEntries(new URLSearchParams(raw));
        } else {
          body = raw;
        }
      }
    }

    const ip = (headers["x-forwarded-for"] || "").split(",")[0].trim();
    const req = {
      method: request.method,
      headers,
      url: url.pathname + url.search,
      query: parseQuery(url.searchParams),
      body,
      socket: { remoteAddress: ip || undefined },
    };

    let status = 200;
    const outHeaders = new Headers();
    const chunks: Uint8Array[] = [];
    let finished = false;
    let resolveResponse!: (r: Response) => void;
    const responsePromise = new Promise<Response>((r) => (resolveResponse = r));
    const enc = new TextEncoder();
    const toBytes = (c: unknown): Uint8Array => {
      if (c == null) return new Uint8Array();
      if (c instanceof Uint8Array) return c;
      if (typeof c === "string") return enc.encode(c);
      return enc.encode(JSON.stringify(c));
    };
    const finish = (chunk?: unknown) => {
      if (finished) return;
      if (chunk != null) chunks.push(toBytes(chunk));
      finished = true;
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(total);
      let o = 0;
      for (const c of chunks) { merged.set(c, o); o += c.length; }
      resolveResponse(new Response(NO_BODY.has(status) ? null : merged, { status, headers: outHeaders }));
    };

    const res: any = {
      get statusCode() { return status; },
      set statusCode(v: number) { status = v; },
      get headersSent() { return finished; },
      status(c: number) { status = c; return res; },
      setHeader(k: string, v: unknown) {
        outHeaders.set(k, Array.isArray(v) ? v.join(", ") : String(v));
        return res;
      },
      getHeader: (k: string) => outHeaders.get(k) ?? undefined,
      removeHeader: (k: string) => { outHeaders.delete(k); },
      writeHead(c: number, h?: Record<string, unknown>) {
        status = c;
        if (h) for (const [k, v] of Object.entries(h)) res.setHeader(k, v);
        return res;
      },
      json(o: unknown) {
        if (!outHeaders.has("content-type")) outHeaders.set("content-type", "application/json; charset=utf-8");
        finish(JSON.stringify(o));
        return res;
      },
      send(b: unknown) {
        if (b != null && typeof b === "object" && !(b instanceof Uint8Array)) return res.json(b);
        finish(b);
        return res;
      },
      write(c: unknown) { chunks.push(toBytes(c)); return true; },
      end(c?: unknown) { finish(c); return res; },
    };

    try {
      await handler(req, res);
      finish(); // handler returned without responding
    } catch (err) {
      console.error("[edge] handler threw:", err);
      if (!finished) {
        status = 500;
        outHeaders.set("content-type", "application/json; charset=utf-8");
        finish(JSON.stringify({ error: "Internal server error" }));
      }
    }
    return responsePromise;
  };
}
