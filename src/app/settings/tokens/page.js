"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";

const MCP_ENDPOINT_PATH = "/api/mcp";
const CLAUDE_DESKTOP_CONFIG_SAMPLE = `{
  "mcpServers": {
    "mindcanvas": {
      "url": "<PASTE_MINDCANVAS_URL>/api/mcp",
      "headers": {
        "Authorization": "Bearer <PASTE_TOKEN_HERE>"
      }
    }
  }
}`;

function getRelativeTimeString(date) {
  if (!date) return "never";
  const now = new Date();
  const diff = now - new Date(date);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function TokensSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tokens, setTokens] = useState([]);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [newlyCreated, setNewlyCreated] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const deployUrl = typeof window !== "undefined"
    ? `${window.location.origin}${MCP_ENDPOINT_PATH}`
    : `https://YOUR_DEPLOY_URL${MCP_ENDPOINT_PATH}`;

  const loadTokens = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/tokens", { method: "GET" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Failed to load tokens");
        return;
      }
      setTokens(Array.isArray(data?.tokens) ? data.tokens : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/tokens", { method: "GET" });
        if (cancelled) return;
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.error || "Failed to load tokens");
          return;
        }
        setTokens(Array.isArray(data?.tokens) ? data.tokens : []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const handleCreate = async (event) => {
    event.preventDefault();
    setCreating(true);
    setError("");
    setNewlyCreated(null);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || "default" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Failed to generate token");
        return;
      }
      setNewlyCreated(data);
      setLabel("");
      await loadTokens();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (tokenId) => {
    if (!window.confirm("Revoke this token? Any client using it will stop working immediately.")) {
      return;
    }
    try {
      const res = await fetch(`/api/tokens/${tokenId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Failed to revoke token");
        return;
      }
      await loadTokens();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCopy = async (value, id) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      // clipboard API may be blocked — fall back silently
    }
  };

  return (
    <div className="flex min-h-screen bg-bone" style={{ background: "var(--bg)" }}>
      <Sidebar />

      <div className="relative min-h-screen flex-1 px-5 pt-6 pb-8 lg:pl-5 pl-14" style={{ background: "var(--bg)" }}>
        <div
          className="flex items-center gap-1 transition-colors cursor-pointer text-sm font-sans"
          style={{ color: "var(--text-muted)" }}
          onClick={() => router.push("/")}
        >
          <span>←</span>
          <span>Spaces</span>
        </div>

        <header className="mt-4">
          <p
            className="font-sans text-xs uppercase tracking-widest font-semibold"
            style={{ color: "var(--text-muted)" }}
          >
            SETTINGS
          </p>
          <h1
            className="font-serif text-3xl font-bold mt-1"
            style={{ color: "var(--text-primary)" }}
          >
            API tokens
          </h1>
          <p
            className="font-sans text-sm mt-1 max-w-2xl leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            Connect MindCanvas to Claude Desktop, Claude.ai Connectors, Cursor, or any
            other MCP client. Generate a personal token below and paste it into your
            client's config. Your token only gives access to <span className="font-semibold">your</span> own MindCanvas data.
          </p>
        </header>

        {error && (
          <p
            className="mt-4 font-sans text-sm rounded-lg px-3 py-2"
            style={{ color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}
          >
            {error}
          </p>
        )}

        <section className="mt-8 max-w-3xl">
          <div className="rounded-2xl p-5" style={{ background: "var(--surface)" }}>
            <h2 className="font-serif text-xl font-bold" style={{ color: "var(--text-primary)" }}>MCP endpoint</h2>
            <p className="font-sans text-sm mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              This is the URL your MCP client will POST to. Use it as-is.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code
                className="themed-placeholder flex-1 min-w-[260px] border rounded-lg px-3 py-2 font-sans text-xs font-mono break-all"
                style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              >
                {deployUrl || `https://YOUR_DEPLOY_URL${MCP_ENDPOINT_PATH}`}
              </code>
              <button
                type="button"
                onClick={() => handleCopy(deployUrl, "endpoint")}
                className="rounded-full border border-pine text-pine hover:bg-pine hover:text-bone font-sans text-sm px-4 py-2 transition-all active:scale-[0.98] font-semibold"
              >
                {copied === "endpoint" ? "Copied!" : "Copy URL"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl p-5 mt-4" style={{ background: "var(--surface)" }}>
            <h2 className="font-serif text-xl font-bold" style={{ color: "var(--text-primary)" }}>Generate a token</h2>
            <p className="font-sans text-sm mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              The raw token is shown exactly <span className="font-semibold">once</span> after
              generation. Copy it now — MindCanvas only stores a hash, so it can never be
              recovered later.
            </p>
            <form onSubmit={handleCreate} className="mt-4 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
                <span className="font-sans text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Label (optional)
                </span>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Claude Desktop"
                  maxLength={60}
                  className="themed-placeholder border rounded-lg px-3 py-2.5 font-sans text-sm outline-none focus:border-clay transition-colors"
                  style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                />
              </label>
              <button
                type="submit"
                disabled={creating}
                className="rounded-full px-5 py-2.5 font-sans text-sm font-semibold shadow-md transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                {creating ? "Generating..." : "Generate token"}
              </button>
            </form>

            {newlyCreated && (
              <div
                className="mt-5 rounded-xl p-4"
                style={{ border: "2px solid var(--accent-secondary)", background: "color-mix(in srgb, var(--accent-secondary) 8%, transparent)" }}
              >
                <p
                  className="font-sans text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--accent-secondary)" }}
                >
                  Your new token — copy it now
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code
                    className="themed-placeholder flex-1 min-w-[260px] border rounded-lg px-3 py-2 font-sans text-xs font-mono break-all"
                    style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                  >
                    {newlyCreated.token}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy(newlyCreated.token, "token")}
                    className="rounded-full font-sans text-sm px-4 py-2 transition-all active:scale-[0.98] font-semibold"
                    style={{ border: "1px solid var(--accent-secondary)", color: "var(--accent-secondary)" }}
                  >
                    {copied === "token" ? "Copied!" : "Copy token"}
                  </button>
                </div>
                <p
                  className="mt-3 font-sans text-xs leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Label: <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{newlyCreated.label || "default"}</span>
                  {" · "}Prefix shown in list: <span className="font-mono" style={{ color: "var(--text-primary)" }}>{newlyCreated.tokenPrefix}…</span>
                </p>
              </div>
            )}
          </div>

          <div className="rounded-2xl p-5 mt-4" style={{ background: "var(--surface)" }}>
            <h2 className="font-serif text-xl font-bold" style={{ color: "var(--text-primary)" }}>Existing tokens</h2>
            {loading ? (
              <p className="font-sans mt-3 animate-pulse" style={{ color: "var(--text-muted)" }}>Loading...</p>
            ) : tokens.length === 0 ? (
              <p className="font-sans mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
                No tokens yet. Generate one above to connect your first MCP client.
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-2">
                {tokens.map((t) => {
                  const revoked = Boolean(t.revoked_at);
                  return (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-3"
                      style={{
                        border: `1px solid ${revoked ? "var(--border)" : "var(--border)"}`,
                        opacity: revoked ? 0.6 : 1,
                      }}
                    >
                      <div className="flex-1 min-w-[200px]">
                        <p className="font-sans text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                          {t.label || "default"}
                          {revoked && <span className="ml-2 italic" style={{ color: "var(--text-muted)" }}>revoked</span>}
                        </p>
                        <p className="font-sans text-xs mt-0.5 font-mono" style={{ color: "var(--text-muted)" }}>
                          {t.token_prefix}…{" · "}created {getRelativeTimeString(t.created_at)}
                          {" · "}last used {getRelativeTimeString(t.last_used_at)}
                        </p>
                      </div>
                      {!revoked && (
                        <button
                          type="button"
                          onClick={() => handleRevoke(t.id)}
                          className="font-sans text-xs font-semibold transition-colors cursor-pointer"
                          style={{ color: "var(--text-muted)" }}
                        >
                          Revoke
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-2xl p-5 mt-4" style={{ background: "var(--surface)" }}>
            <h2 className="font-serif text-xl font-bold" style={{ color: "var(--text-primary)" }}>Connecting Claude Desktop</h2>
            <p className="font-sans text-sm mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Open your <code className="px-1.5 py-0.5 rounded text-xs" style={{ background: "var(--bg)", color: "var(--text-primary)" }}>claude_desktop_config.json</code> file
              and add MindCanvas as an MCP server, then restart Claude Desktop. The file lives at:
            </p>
            <ul className="mt-2 font-sans text-xs leading-relaxed list-disc ml-5" style={{ color: "var(--text-secondary)" }}>
              <li>macOS: <code className="font-mono">~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
              <li>Windows: <code className="font-mono">%AppData%\Claude\claude_desktop_config.json</code></li>
            </ul>
            <pre
              className="mt-3 border rounded-lg p-3 font-mono text-xs overflow-x-auto whitespace-pre"
              style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              {CLAUDE_DESKTOP_CONFIG_SAMPLE}
            </pre>
            <p className="font-sans text-xs mt-3 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Replace <code className="font-mono">{"<PASTE_MINDCANVAS_URL>"}</code> with{" "}
              <code className="font-mono">{deployUrl || "https://YOUR_DEPLOY_URL/api/mcp"}</code> and{" "}
              <code className="font-mono">{"<PASTE_TOKEN_HERE>"}</code> with your generated token (starts with{" "}
              <code className="font-mono">mc_…</code>).
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
