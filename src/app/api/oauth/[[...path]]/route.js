// Catch-all OAuth 2.0 authorization server endpoint powered by oidc-provider.
// Routes: /api/oauth/register, /api/oauth/auth, /api/oauth/token,
// /api/oauth/introspect, /api/oauth/revoke, /.well-known/openid-configuration.
// The oidc-provider handles these internally via Koa middleware; this route
// passes the Next.js Request into the Koa-based provider.

import { getProvider } from "@/lib/oauth/provider";
import { isServiceRoleConfigured } from "@/lib/mcp/auth";
import Provider from "oidc-provider";

function buildOrigin(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

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

  const origin = buildOrigin(request);
  const provider = await getProvider(origin);

  const bodyStream = await bodyToNodeStream(request);

  const fakeReq = {
    method: request.method,
    url: oidcRequestUrl(request),
    headers: Object.fromEntries(
      [...request.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]),
    ),
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

  const fakeRes = {
    _statusCode: 200,
    _headers: {},
    _bodyChunks: [],
    setHeader(name, value) {
      this._headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return this._headers[name.toLowerCase()];
    },
    removeHeader(name) {
      delete this._headers[name.toLowerCase()];
    },
    writeHead(code, headers = {}) {
      this._statusCode = code;
      Object.assign(this._headers, headers);
    },
    write(chunk) {
      if (chunk) this._bodyChunks.push(chunk);
    },
    end(chunk) {
      if (chunk) this._bodyChunks.push(chunk);
    },
    once() {},
    on() {},
    emit() {},
    get finished() { return false; },
    _finalize() {
      let body = null;
      if (this._bodyChunks.length > 0) {
        body = Buffer.concat(this._bodyChunks);
      }
      const headers = {};
      for (const [k, v] of Object.entries(this._headers)) {
        if (v !== undefined) headers[k] = v;
      }
      return { status: this._statusCode, body, headers };
    },
  };

  return new Promise((resolve, reject) => {
    try {
      // provider.callback() returns the classic Koa (req, res) handler.
      const handler = provider.callback();

      handler(fakeReq, fakeRes, (err) => {
        if (err) {
          resolve(
            new Response(
              JSON.stringify({
                error: "server_error",
                error_description: err.message,
              }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            ),
          );
          return;
        }
        const { status, body, headers } = fakeRes._finalize();
        resolve(new Response(body, { status, headers }));
      });
    } catch (err) {
      reject(err);
    }
  });
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