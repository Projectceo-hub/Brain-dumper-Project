"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { createClient } from "@/lib/supabase/client";
import { THEMES, getStoredTheme, setTheme } from "@/components/ThemeProvider";

// Static hex values for the theme picker swatches. These mirror the CSS
// custom properties defined per theme in globals.css. The swatch needs the
// values up-front (before a theme is active) so we hardcode them here rather
// than reading CSS vars from an inactive selector.
const THEME_SWATCHES = {
  "warm-canvas": { bg: "#F2EDE4", accent: "#C4571F" },
  "dark-studio": { bg: "#1A1815", accent: "#D4651F" },
  midnight: { bg: "#0A0A0A", accent: "#C4571F" },
  sepia: { bg: "#F5EDD6", accent: "#A8380A" },
  slate: { bg: "#EEF2F7", accent: "#C4571F" },
};

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
      <span className="font-sans text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [displayNameOrig, setDisplayNameOrig] = useState("");
  const [displayNameSaving, setDisplayNameSaving] = useState(false);
  const [displayNameMsg, setDisplayNameMsg] = useState("");

  const [newEmail, setNewEmail] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");
  const [emailError, setEmailError] = useState("");

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwError, setPwError] = useState("");

  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const [theme, setThemeState] = useState("warm-canvas");

  useEffect(() => {
    setThemeState(getStoredTheme());
    const supabase = createClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      const name = data.user?.user_metadata?.display_name || "";
      setDisplayName(name);
      setDisplayNameOrig(name);
    });
  }, []);

  const handleSaveDisplayName = async (e) => {
    e.preventDefault();
    setDisplayNameSaving(true);
    setDisplayNameMsg("");
    const supabase = createClient();
    if (!supabase) {
      setDisplayNameMsg("Supabase not configured.");
      setDisplayNameSaving(false);
      return;
    }
    const { error } = await supabase.auth.updateUser({
      data: { display_name: displayName.trim() },
    });
    if (error) {
      setDisplayNameMsg(error.message);
    } else {
      setDisplayNameOrig(displayName.trim());
      setDisplayNameMsg("Display name saved.");
      window.dispatchEvent(new CustomEvent("mindcanvas:profile-updated"));
    }
    setDisplayNameSaving(false);
  };

  const handleChangeEmail = async (e) => {
    e.preventDefault();
    setEmailSaving(true);
    setEmailMsg("");
    setEmailError("");
    const supabase = createClient();
    if (!supabase) {
      setEmailError("Supabase not configured.");
      setEmailSaving(false);
      return;
    }
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    if (error) {
      setEmailError(error.message);
    } else {
      setEmailMsg("Confirmation links have been sent to both your current and new email addresses.");
      setNewEmail("");
    }
    setEmailSaving(false);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwSaving(true);
    setPwMsg("");
    setPwError("");
    if (newPw !== confirmPw) {
      setPwError("New passwords do not match.");
      setPwSaving(false);
      return;
    }
    if (newPw.length < 6) {
      setPwError("New password must be at least 6 characters.");
      setPwSaving(false);
      return;
    }
    const supabase = createClient();
    if (!supabase) {
      setPwError("Supabase not configured.");
      setPwSaving(false);
      return;
    }
    // Re-auth with current password to satisfy Supabase's reauthentication
    // requirement before changing password.
    const { data: userData } = await supabase.auth.getUser();
    const userEmail = userData.user?.email;
    if (!userEmail) {
      setPwError("Could not determine current email.");
      setPwSaving(false);
      return;
    }
    const { error: reauthErr } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password: currentPw,
    });
    if (reauthErr) {
      setPwError("Current password is incorrect.");
      setPwSaving(false);
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) {
      setPwError(error.message);
    } else {
      setPwMsg("Password changed.");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    }
    setPwSaving(false);
  };

  const handleDeleteAccount = async (e) => {
    e.preventDefault();
    if (deleteConfirm !== "DELETE") return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(body?.error || "Failed to delete account.");
        setDeleting(false);
        return;
      }
      const supabase = createClient();
      if (supabase) await supabase.auth.signOut();
      router.push("/");
    } catch (err) {
      setDeleteError(err?.message || "Failed to delete account.");
      setDeleting(false);
    }
  };

  const pickTheme = (id) => {
    setTheme(id);
    setThemeState(id);
  };

  const cardStyle = {
    background: "var(--surface)",
    borderRadius: "16px",
  };

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <Sidebar />

      <div className="relative min-h-screen flex-1 px-5 pt-6 pb-8 lg:pl-5 pl-14" style={{ background: "var(--bg)" }}>
        <div
          className="flex items-center gap-1 text-sm font-sans cursor-pointer transition-colors"
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
          <h1 className="font-serif text-3xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>
            Settings
          </h1>
        </header>

        {/* ----------------------------- Account ----------------------------- */}
        <section className="mt-8 max-w-3xl">
          <h2 className="font-serif text-xl font-bold mb-3" style={{ color: "var(--text-primary)" }}>
            Account
          </h2>

          <div className="p-5 mb-4" style={cardStyle}>
            <form onSubmit={handleSaveDisplayName} className="flex flex-wrap items-end gap-3">
              <Field label="Display name">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  maxLength={60}
                  className="bg-transparent border rounded-lg px-3 py-2.5 font-sans text-sm outline-none transition-colors"
                  style={{
                    color: "var(--text-primary)",
                    borderColor: "var(--border)",
                  }}
                />
              </Field>
              <button
                type="submit"
                disabled={displayNameSaving || displayName.trim() === displayNameOrig.trim()}
                className="rounded-full px-5 py-2.5 font-sans text-sm font-semibold shadow-md transition-all active:scale-[0.98] disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                {displayNameSaving ? "Saving..." : "Save"}
              </button>
            </form>
            {displayNameMsg && (
              <p className="mt-3 font-sans text-sm" style={{ color: "var(--text-secondary)" }}>
                {displayNameMsg}
              </p>
            )}
          </div>

          <div className="p-5 mb-4" style={cardStyle}>
            <h3 className="font-serif text-lg font-bold" style={{ color: "var(--text-primary)" }}>
              Change email
            </h3>
            <form onSubmit={handleChangeEmail} className="mt-3 flex flex-wrap items-end gap-3">
              <Field label="New email">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                  className="bg-transparent border rounded-lg px-3 py-2.5 font-sans text-sm outline-none transition-colors"
                  style={{
                    color: "var(--text-primary)",
                    borderColor: "var(--border)",
                  }}
                />
              </Field>
              <button
                type="submit"
                disabled={emailSaving || !newEmail.trim()}
                className="rounded-full px-5 py-2.5 font-sans text-sm font-semibold shadow-md transition-all active:scale-[0.98] disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                {emailSaving ? "Sending..." : "Change email"}
              </button>
            </form>
            {emailError && (
              <p className="mt-3 font-sans text-sm" style={{ color: "#DC2626" }}>
                {emailError}
              </p>
            )}
            {emailMsg && (
              <p className="mt-3 font-sans text-sm" style={{ color: "var(--text-secondary)" }}>
                {emailMsg}
              </p>
            )}
          </div>

          <div className="p-5 mb-4" style={cardStyle}>
            <h3 className="font-serif text-lg font-bold" style={{ color: "var(--text-primary)" }}>
              Change password
            </h3>
            <form onSubmit={handleChangePassword} className="mt-3 flex flex-col gap-3">
              <Field label="Current password">
                <input
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="bg-transparent border rounded-lg px-3 py-2.5 font-sans text-sm outline-none transition-colors"
                  style={{
                    color: "var(--text-primary)",
                    borderColor: "var(--border)",
                  }}
                />
              </Field>
              <div className="flex flex-wrap gap-3">
                <Field label="New password">
                  <input
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    className="bg-transparent border rounded-lg px-3 py-2.5 font-sans text-sm outline-none transition-colors"
                    style={{
                      color: "var(--text-primary)",
                      borderColor: "var(--border)",
                    }}
                  />
                </Field>
                <Field label="Confirm new password">
                  <input
                    type="password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    className="bg-transparent border rounded-lg px-3 py-2.5 font-sans text-sm outline-none transition-colors"
                    style={{
                      color: "var(--text-primary)",
                      borderColor: "var(--border)",
                    }}
                  />
                </Field>
              </div>
              <button
                type="submit"
                disabled={pwSaving || !currentPw || !newPw || !confirmPw}
                className="self-start rounded-full px-5 py-2.5 font-sans text-sm font-semibold shadow-md transition-all active:scale-[0.98] disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                {pwSaving ? "Changing..." : "Change password"}
              </button>
            </form>
            {pwError && (
              <p className="mt-3 font-sans text-sm" style={{ color: "#DC2626" }}>
                {pwError}
              </p>
            )}
            {pwMsg && (
              <p className="mt-3 font-sans text-sm" style={{ color: "var(--text-secondary)" }}>
                {pwMsg}
              </p>
            )}
          </div>

          {/* Danger zone */}
          <div
            className="p-5 mt-8"
            style={{
              border: `1px solid rgba(220, 38, 38, 0.4)`,
              borderRadius: "16px",
            }}
          >
            <h3 className="font-serif text-lg font-bold" style={{ color: "#DC2626" }}>
              Delete account
            </h3>
            <p className="font-sans text-sm mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              This permanently deletes your account and all your notes and spaces. This cannot be undone.
            </p>
            <form onSubmit={handleDeleteAccount} className="mt-4 flex flex-wrap items-end gap-3">
              <Field label='Type "DELETE" to confirm'>
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder="DELETE"
                  className="bg-transparent border rounded-lg px-3 py-2.5 font-sans text-sm outline-none transition-colors"
                  style={{
                    color: "var(--text-primary)",
                    borderColor: "rgba(220, 38, 38, 0.4)",
                  }}
                />
              </Field>
              <button
                type="submit"
                disabled={deleting || deleteConfirm !== "DELETE"}
                className="rounded-full px-5 py-2.5 font-sans text-sm font-semibold shadow-md transition-all active:scale-[0.98] disabled:opacity-50"
                style={{ background: "#DC2626", color: "#fff" }}
              >
                {deleting ? "Deleting..." : "Delete my account"}
              </button>
            </form>
            {deleteError && (
              <p className="mt-3 font-sans text-sm" style={{ color: "#DC2626" }}>
                {deleteError}
              </p>
            )}
          </div>
        </section>

        {/* ----------------------------- Appearance ----------------------------- */}
        <section className="mt-12 max-w-3xl">
          <h2 className="font-serif text-xl font-bold mb-3" style={{ color: "var(--text-primary)" }}>
            Appearance
          </h2>
          <div className="p-5" style={cardStyle}>
            <p className="font-sans text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
              Choose a theme. It saves to this device and applies across the whole app.
            </p>
            <div className="flex flex-wrap gap-6">
              {THEMES.map((t) => {
                const swatch = THEME_SWATCHES[t.id];
                const active = theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => pickTheme(t.id)}
                    className="flex flex-col items-center gap-2 cursor-pointer"
                    aria-label={`Switch to ${t.name} theme`}
                    aria-pressed={active}
                  >
                    <span
                      className="flex items-center justify-center rounded-full transition-transform"
                      style={{
                        width: 48,
                        height: 48,
                        background: swatch.bg,
                        boxShadow: active
                          ? "0 0 0 2px #fff, 0 0 0 4px " + swatch.accent
                          : "0 0 0 1px var(--border)",
                      }}
                    >
                      <span
                        className="flex items-center justify-center rounded-full"
                        style={{ width: 32, height: 32, background: swatch.accent }}
                      >
                        {active && (
                          <span className="text-white text-base font-bold leading-none">✓</span>
                        )}
                      </span>
                    </span>
                    <span
                      className="font-sans text-[11px]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {t.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* ----------------------------- Integrations ----------------------------- */}
        <section className="mt-12 max-w-3xl mb-16">
          <h2 className="font-serif text-xl font-bold mb-3" style={{ color: "var(--text-primary)" }}>
            Integrations
          </h2>
          <div className="flex flex-col gap-4">
            <Link
              href="/settings/tokens"
              className="block p-5 transition-all active:scale-[0.99]"
              style={cardStyle}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-serif text-lg font-bold" style={{ color: "var(--text-primary)" }}>
                    API Tokens
                  </h3>
                  <p className="font-sans text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
                    Connect MindCanvas to Claude Desktop and other MCP clients
                  </p>
                </div>
                <span className="font-sans text-sm" style={{ color: "var(--text-muted)" }}>
                  →
                </span>
              </div>
            </Link>

            <div
              className="block p-5 opacity-60"
              style={{ ...cardStyle, border: "1px solid var(--border)" }}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-serif text-lg font-bold" style={{ color: "var(--text-primary)" }}>
                    Claude.ai Web Connector
                  </h3>
                  <p className="font-sans text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
                    Connect directly to claude.ai in your browser
                  </p>
                </div>
                <span
                  className="font-sans text-xs font-semibold px-2 py-1 rounded-full"
                  style={{
                    background: "var(--border)",
                    color: "var(--text-secondary)",
                  }}
                >
                  Coming soon
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
