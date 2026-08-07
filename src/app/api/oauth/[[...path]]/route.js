// Catch-all OAuth 2.0 authorization server endpoint powered by oidc-provider.
// The issuer is <origin>/api/oauth, so oidc-provider's own route names sit
// under this prefix: /api/oauth/auth, /api/oauth/token, /api/oauth/reg (DCR),
// /api/oauth/token/introspection, /api/oauth/token/revocation, /api/oauth/jwks,
// and the resume path /api/oauth/auth/<uid>. The provider's router matches the
// UN-prefixed path, so oidcRequestUrl strips /api/oauth before handing the
// request to the Koa-based provider.

import { getProvider } from "@/lib/oauth/provider";
import { isServiceRoleConfigured } from "@/lib/mcp/auth";
import { resolvePublicOrigin, resolveOAuthIssuer, OAUTH_MOUNT_PATH } from "@/lib/publicOrigin";

const OAUTH_PREFIX = OAUTH_MOUNT_PATH;

function oidcRequestUrl(request) {
  const url = new URL(request.url);
  let path = url.pathname;
  if (path.startsWith(OAUTH_PREFIX)) {
    path = path.slice(OAUTH_PREFIX.length) || "/";
  }
  return path + url.search;
}

import { Readable } from "node:stream";

// TEMPORARY DEBUG. Mask token/secret values so a logged response preview can
// never leak a credential. Covers the JSON string fields oidc-provider emits
// (token responses, DCR registration_access_token, authorization codes).
// Remove together with the console.error calls below once the flow is verified.
function redactSensitive(text) {
  return String(text).replace(
    /("(?:access_token|refresh_token|id_token|client_secret|registration_access_token|code)"\s*:\s*")[^"]*(")/gi,
    "$1[REDACTED]$2",
  );
}

async function handleRequest(request) {
  // TEMPORARY DEBUG (step 1): incoming method + url.
  console.error(`[oauth-debug] -> ${request.method} ${request.url}`);

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
  // Issuer carries the /api/oauth mount path so every URL oidc-provider emits
  // is prefixed and lands back on this catch-all. The router still matches the
  // un-prefixed path, so oidcRequestUrl below keeps stripping the prefix.
  const provider = await getProvider(resolveOAuthIssuer(request));

  // Read the whole body once, up front. The previous shim hand-wired
  // on/once/pipe onto a plain object and forwarded them to a separately
  // created Readable; oidc-provider's body-parser (raw-body) did not reliably
  // receive the 'data'/'end' events through that indirection, so a DCR POST
  // could be parsed as an empty body and rejected as 400
  // invalid_client_metadata even though Claude sent valid metadata.
  //
  // Readable.from([Buffer]) IS a real IncomingMessage-shaped stream that
  // emits the buffer then 'end' with no custom plumbing. We attach the
  // request metadata Koa reads (method/url/headers/socket) directly onto it.
  const rawBody = await request.text();
  // TEMPORARY DEBUG (step 2): body length only — never the body itself, which
  // can contain code_verifier / authorization codes.
  console.error(`[oauth-debug] rawBody length=${rawBody.length}`);
  const fakeReq = Readable.from([Buffer.from(rawBody)]);
  fakeReq.method = request.method;
  fakeReq.url = oidcRequestUrl(request);
  fakeReq.headers = Object.fromEntries(
    [...request.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]),
  );
  // Koa reads req.socket for ctx.ip and, when no X-Forwarded-Proto header is
  // present, for ctx.protocol. `encrypted` is derived from the resolved issuer
  // scheme so ctx.protocol matches the origin the provider was built with —
  // hardcoding it true would make ctx.protocol https on a local http request
  // and mismatch the http issuer, breaking localhost testing.
  fakeReq.socket = {
    encrypted: origin.startsWith("https:"),
    remoteAddress: "127.0.0.1",
  };

  // `statusCode` must be a real writable property: Koa sets the response
  // status by assigning res.statusCode directly, and only falls back to
  // writeHead in some paths. The previous shape stored status solely in
  // _statusCode, so any status Koa set this way was discarded and every
  // response would have gone out as 200.
  //
  // It starts null, not 200. Koa assigns res.statusCode = 404 before running
  // middleware and then the real status, so every genuine response overwrites
  // this. If it is still null at the end, the handler never wrote a status —
  // a silent failure that must surface as a 500, not a false 200.
  const fakeRes = {
    statusCode: null,
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
    // TEMPORARY DEBUG (step 3): status + redacted first 500 chars of the body.
    const previewBody = fakeRes._bodyChunks.length
      ? Buffer.concat(fakeRes._bodyChunks).toString("utf8")
      : "";
    console.error(
      `[oauth-debug] <- status=${fakeRes.statusCode} body=${redactSensitive(previewBody).slice(0, 500)}`,
    );
  } catch (err) {
    // TEMPORARY DEBUG (step 4): full stack of any caught error.
    console.error("[oauth-debug] handler threw:", err?.stack || err);
    console.error("OAuth handler error:", err);
    return new Response(
      JSON.stringify({
        error: "server_error",
        error_description: err?.message || String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const { status: rawStatus, body, headers } = fakeRes._finalize();

  // A null/undefined status means nothing ever wrote a response: treat it as a
  // 500 so a silent empty reply surfaces as an error instead of a false 200.
  const status = rawStatus == null ? 500 : rawStatus;

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