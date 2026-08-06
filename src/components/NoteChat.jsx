"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  getChatHistory,
  saveChatHistory,
  clearChatHistory,
} from "@/lib/db";
import { getActiveNote } from "@/lib/activeNote";

// Phase 10 — Chat with Notes.
//
// The panel is mounted once in layout.js (outside AuthGate, so it never
// remounts on route change and never loses a thread mid-navigation). It
// renders nothing until opened.
//
// The trigger lives in the sidebar nav instead of inside the panel's own
// subtree, so the two communicate through a window event rather than props
// or context. That keeps NoteChat's state fully internal — Sidebar imports
// only a dumb button.
const OPEN_EVENT = "mindcanvas:open-chat";

// 1 row at rest, grows to 3 before it starts scrolling. Values match the
// 14px/1.5 line-height used on the textarea below.
const LINE_HEIGHT = 21;
const TEXTAREA_PADDING = 20;
const MAX_TEXTAREA_HEIGHT = LINE_HEIGHT * 3 + TEXTAREA_PADDING;

function ChatBubbleIcon({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.5 8.5 0 0 1-9.1 8.5 8.6 8.6 0 0 1-3.4-.8L3 21l1.8-5.1A8.4 8.4 0 0 1 4 11.9 8.5 8.5 0 0 1 12.5 3a8.5 8.5 0 0 1 8.5 8.5z" />
    </svg>
  );
}

function CloseIcon({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function SendIcon({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

// Rendered in the sidebar nav list. Styling comes from .mc-nav-item so it
// picks up the same hover/active treatment as Home / Graph / Import.
export function AskAiTrigger({ onNavigate }) {
  return (
    <button
      type="button"
      className="mc-nav-item"
      onClick={() => {
        onNavigate?.();
        window.dispatchEvent(new CustomEvent(OPEN_EVENT));
      }}
    >
      <ChatBubbleIcon />
      Ask AI
    </button>
  );
}

// `activeNote` is accepted as a prop for direct use, but defaults to the
// shared module value — NoteChat is mounted in layout.js, far from the editor
// that knows which note is open, so there is no parent able to pass it.
export default function NoteChat({ activeNote = null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const threadRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_EVENT, handleOpen);
  }, []);

  // Restore the persisted thread each time the panel opens. Reading on open
  // rather than on mount keeps IndexedDB out of the initial page load, since
  // this component is mounted on every route.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      const stored = await getChatHistory();
      if (!cancelled && stored.length > 0) setMessages(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Closing clears the panel's UI state only — Dexie keeps the thread, so it
  // reloads on the next open. "Clear" is the only thing that discards it.
  const handleClose = useCallback(() => {
    setIsOpen(false);
    setMessages([]);
    setInputValue("");
    setError("");
    setIsLoading(false);
  }, []);

  const handleClearThread = useCallback(async () => {
    setMessages([]);
    setError("");
    await clearChatHistory();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, handleClose]);

  useEffect(() => {
    if (!isOpen) return;
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isLoading, isOpen]);

  useEffect(() => {
    if (isOpen) textareaRef.current?.focus();
  }, [isOpen]);

  const autoResize = (el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  };

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;

    const thread = [...messages, { role: "user", content: text }];
    setMessages(thread);
    saveChatHistory(thread);
    setInputValue("");
    setError("");
    setIsLoading(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      // The server authorizes off the session cookie; userId is sent for
      // parity with the documented API shape, not as a credential.
      let userId = null;
      try {
        const supabase = createClient();
        const { data } = (await supabase?.auth.getUser()) || {};
        userId = data?.user?.id || null;
      } catch {
        // Fall through — the route resolves identity from cookies anyway.
      }

      // Read at send time, not render time, so the model sees what is in the
      // editor right now — including text the user has not saved yet.
      const note = activeNote || getActiveNote();

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: thread, userId, activeNote: note }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error || "Something went wrong. Try again.");
        return;
      }

      setMessages((prev) => {
        const next = [...prev, { role: "assistant", content: data.reply }];
        saveChatHistory(next);
        return next;
      });
    } catch (err) {
      setError(err?.message || "Could not reach the assistant.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-label="Ask your notes"
      className="animate-slide-in-right fixed inset-x-0 bottom-0 z-50 flex h-[70vh] flex-col rounded-t-[20px] border-t md:inset-x-auto md:right-0 md:top-0 md:h-full md:w-[340px] md:rounded-none md:border-l md:border-t-0"
      style={{
        background: "var(--bg-primary)",
        borderColor: "var(--border-1)",
        boxShadow: "var(--shadow-capture)",
      }}
    >
      {/* ------------------------------- header ------------------------------ */}
      <div
        className="flex shrink-0 items-center justify-between border-b px-4 py-3.5"
        style={{ borderColor: "var(--border-1)" }}
      >
        <h2
          className="mc-display text-[17px] leading-none"
          style={{ color: "var(--text-strong)" }}
        >
          Ask your notes
        </h2>
        <div className="flex shrink-0 items-center gap-3">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClearThread}
              className="bg-transparent p-0 text-[12px] transition-colors"
              style={{ border: "none", color: "var(--text-muted)" }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close chat"
            className="shrink-0 transition-colors"
            style={{ color: "var(--text-dim)" }}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* ------------------------------- thread ------------------------------ */}
      <div
        ref={threadRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
      >
        {messages.length === 0 && !isLoading && (
          <p
            className="mt-2 text-[13px] leading-relaxed"
            style={{ color: "var(--text-dim)" }}
          >
            Ask anything about what you&apos;ve written — what you noted on a
            topic, what a space contains, or where something came up.
          </p>
        )}

        {messages.map((message, i) => (
          <div
            key={`${message.role}-${i}`}
            className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-3 text-[13.5px] leading-relaxed ${
              message.role === "user" ? "self-end" : "self-start"
            }`}
            style={
              message.role === "user"
                ? { background: "var(--accent-green)", color: "#fff" }
                : {
                    background: "var(--card-bg)",
                    color: "var(--text-body)",
                    border: "1px solid var(--border-1)",
                  }
            }
          >
            {message.content}
          </div>
        ))}

        {isLoading && (
          <div
            className="flex max-w-[80%] items-center gap-1.5 self-start rounded-2xl px-3.5 py-4"
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--border-1)",
            }}
            aria-label="Thinking"
          >
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="h-1.5 w-1.5 animate-pulse rounded-full"
                style={{
                  background: "var(--text-dim)",
                  animationDelay: `${delay}ms`,
                }}
              />
            ))}
          </div>
        )}

        {error && (
          <p className="self-start text-[12px]" style={{ color: "#C4571F" }}>
            {error}
          </p>
        )}
      </div>

      {/* -------------------------------- input ------------------------------ */}
      <div
        className="flex shrink-0 items-end gap-2 border-t p-3"
        style={{ borderColor: "var(--border-1)" }}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            autoResize(e.target);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your notes…"
          className="themed-placeholder min-h-0 flex-1 resize-none rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-[21px] outline-none"
          style={{
            background: "var(--bg-neutral-100)",
            color: "var(--text-strong)",
            maxHeight: `${MAX_TEXTAREA_HEIGHT}px`,
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!inputValue.trim() || isLoading}
          aria-label="Send"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full transition-opacity disabled:opacity-40"
          style={{ background: "var(--accent-green)", color: "#fff" }}
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}
