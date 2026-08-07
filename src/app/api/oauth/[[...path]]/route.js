// Catch-all OAuth 2.0 authorization server endpoint powered by oidc-provider.
// Routes: /api/oauth/register, /api/oauth/auth, /api/oauth/token,
// /api/oauth/introspect, /api/oauth/revoke, /.well-known/openid-configuration.
// The oidc-provider handles these internally via Koa middleware; this route
// passes the Next.js Request into the Koa-based provider.

import { getProvider } from "@/lib/oauth/provider";
import { isServiceRoleConfigured } from "@/lib/mcp/auth";
import { resolvePublicOrigin } from "@/lib/publicOrigin";

const OAUTH_PREFIX = "/api/oauth";

function oidcRequestUrl(request) {
  const url = new URL(request.url);
  let path = url.pathname;
  if (path.startsWith(OAUTH_PREFIX)) {
    path = path.slice(OAUTH_PREFIX.length) || "/";
  }
  return path + url.search;
}

import { Readable } from "node:stream";

async function bodyToNodeStream(request) {
  try {
    const buffer = Buffer.from(await request.arrayBuffer());
    const stream = new Readable({
      read() {
        this.push(buffer);
        this.push(null);
      },
    });
    return stream;
  } catch {
    const stream = new Readable({
      read() { this.push(null); },
    });
    return stream;
  }
}

async function handleRequest(request) {
  if (!isServiceRoleConfigured()) {
    return new Response(
      JSON.stringify({
        error: "service_unavailable",
        error_description: "OAuth server not configured: SUPABASE_SERVICE_ROLE_KEY is missing.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  const origin = resolvePublicOrigin(request);
  const provider = await getProvider(origin);

  const bodyStream = await bodyToNodeStream(request);

  const fakeReq = {
    method: request.method,
    url: oidcRequestUrl(request),
    headers: Object.fromEntries(
      [...request.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]),
    ),
    // Koa reads req.socket for ctx.ip and, when no X-Forwarded-Proto is
    // present, for ctx.protocol. Without it those getters throw on a plain
    // object. `encrypted` mirrors the original request's scheme so local
    // http and deployed https both resolve correctly.
    socket: {
      encrypted: new URL(request.url).protocol === "https:",
      remoteAddress: "127.0.0.1",
    },
    // Provide a proper Node.js Readable for oidc-provider/body-parser:
    readable: true,
    readableLength: 0,
    readableEncoding: null,
    destroyed: false,
    on: (...args) => { bodyStream.on(...args); },
    once: (...args) => { bodyStream.once(...args); },
    removeListener: (...args) => { bodyStream.removeListener(...args); },
    pipe: (...args) => { return bodyStream.pipe(...args); },
    resume: () => {},
    pause: () => {},
    read: () => null,
    // Koa will read req for 'data'/'end' events when chunky:
  };

  // `statusCode` must be a real writable property: Koa sets the response
  // status by assigning res.statusCode directly, and only falls back to
  // writeHead in some paths. The previous shape stored status solely in
  // _statusCode, so any status Koa set this way was discarded and every
  // response would have gone out as 200.
  const fakeRes = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    finished: false,
    _headers: {},
    _bodyChunks: [],
    setHeader(name, value) {
      this._headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name) {
      return this._headers[name.toLowerCase()];
    },
    getHeaderNames() {
      return Object.keys(this._headers);
    },
    hasHeader(name) {
      return name.toLowerCase() in this._headers;
    },
    removeHeader(name) {
      delete this._headers[name.toLowerCase()];
    },
    writeHead(code, headers = {}) {
      this.statusCode = code;
      Object.assign(this._headers, headers);
      return this;
    },
    flushHeaders() {},
    write(chunk) {
      if (chunk) this._bodyChunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk) this._bodyChunks.push(Buffer.from(chunk));
      this.writableEnded = true;
      this.finished = true;
    },
    once() { return this; },
    on() { return this; },
    off() { return this; },
    removeListener() { return this; },
    emit() { return false; },
    _finalize() {
      let body = null;
      if (this._bodyChunks.length > 0) {
        body = Buffer.concat(this._bodyChunks);
      }
      const headers = {};
      for (const [k, v] of Object.entries(this._headers)) {
        if (v !== undefined) headers[k] = v;
      }
      return { status: this.statusCode, body, headers };
    },
  };

  // provider.callback() returns Koa's (req, res) handler, which RETURNS A
  // PROMISE and takes exactly two arguments — confirmed against the installed
  // version: handler.length === 2.
  //
  // This used to pass a third `next` callback and resolve the response from
  // inside it. Koa never calls a third argument, so that callback never ran
  // and the surrounding Promise never settled: every request to /api/oauth/*
  // hung until the platform timed it out. Nothing in the OAuth flow —
  // registration, authorization, token exchange — could complete.
  try {
    const handler = provider.callback();
    await handler(fakeReq, fakeRes);
  } catch (err) {
    console.error("OAuth handler error:", err);
    return new Response(
      JSON.stringify({
        error: "server_error",
        error_description: err?.message || String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const { status, body, headers } = fakeRes._finalize();

  // 204/304 must not carry a body.
  const bodyless = status === 204 || status === 304;
  return new Response(bodyless ? null : body, { status, headers });
}

export async function GET(request) {
  return handleRequest(request);
}

export async function POST(request) {
  return handleRequest(request);
}

export async function DELETE(request) {
  return handleRequest(request);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Origin",
    },
  });
}