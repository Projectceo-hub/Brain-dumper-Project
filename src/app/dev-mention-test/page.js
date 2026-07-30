"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const FAKE_NOTES = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];

export default function DevMentionTestPage() {
  const editorRef = useRef(null);
  const dropdownRef = useRef(null);

  const [mention, setMention] = useState({
    open: false,
    query: "",
    startIndex: null,
    results: [],
    activeIndex: 0,
  });

  const [serializedText, setSerializedText] = useState("");
  const [loadInput, setLoadInput] = useState("");

  const updateMentionResults = (query) => {
    if (query === "") return FAKE_NOTES;
    return FAKE_NOTES.filter((n) =>
      n.toLowerCase().startsWith(query.toLowerCase())
    );
  };

  const closeMention = useCallback(() => {
    setMention({
      open: false,
      query: "",
      startIndex: null,
      results: [],
      activeIndex: 0,
    });
  }, []);

  const insertMentionAtCursor = (noteName) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    const editor = editorRef.current;
    if (!editor || !editor.contains(range.commonAncestorContainer)) return;

    const span = document.createElement("span");
    span.setAttribute("contenteditable", "false");
    span.setAttribute("data-mention", noteName);
    span.className = "mention-token";
    span.textContent = `@${noteName}`;

    span.addEventListener("click", () => {
      alert("would navigate to: " + noteName);
    });

    range.deleteContents();
    range.insertNode(span);

    const space = document.createTextNode("\u00A0");
    range.setStartAfter(span);
    range.setEndAfter(span);
    range.insertNode(space);

    range.setStartAfter(space);
    range.setEndAfter(space);
    sel.removeAllRanges();
    sel.addRange(range);

    editor.normalize();
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const handleInput = (e) => {
    const editor = e.currentTarget;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      closeMention();
      return;
    }

    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      closeMention();
      return;
    }

    const caretOffset = range.startOffset;
    const node = range.startContainer;
    const text = node.nodeType === Node.TEXT_NODE ? node.textContent : "";

    let i = caretOffset - 1;
    while (i >= 0) {
      const ch = text[i];
      if (ch === "@") {
        const before = i === 0 || /\s/.test(text[i - 1] || " ");
        if (before) {
          const query = text.slice(i + 1, caretOffset);
          if (!/\s/.test(query)) {
            const results = updateMentionResults(query);
            setMention({
              open: true,
              query,
              startIndex: i,
              results,
              activeIndex: 0,
            });
            return;
          }
        }
        closeMention();
        return;
      }
      if (/\s/.test(ch)) {
        closeMention();
        return;
      }
      i--;
    }
    closeMention();
  };

  const handleKeyDown = (e) => {
    if (mention.open && mention.results.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setMention((m) => ({
          ...m,
          activeIndex: (m.activeIndex + 1) % m.results.length,
        }));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setMention((m) => ({
          ...m,
          activeIndex:
            (m.activeIndex - 1 + m.results.length) % m.results.length,
        }));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const noteName = mention.results[mention.activeIndex];
        acceptMention(noteName);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMention();
        return;
      }
    }
  };

  const acceptMention = (noteName) => {
    const editor = editorRef.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);

    let textNode = range.startContainer;
    let offset = range.startOffset;

    if (textNode.nodeType !== Node.TEXT_NODE) {
      const walker = document.createTreeWalker(
        editor,
        NodeFilter.SHOW_TEXT,
        null
      );
      let n = walker.currentNode;
      while (n) {
        if (n.nodeValue && n.nodeValue.includes("@")) {
          textNode = n;
          break;
        }
        n = walker.nextNode();
      }
    }

    if (textNode.nodeType === Node.TEXT_NODE) {
      const text = textNode.textContent || "";
      const at = mention.startIndex;
      if (at != null && at >= 0 && at < text.length && text[at] === "@") {
        const before = text.slice(0, at);
        const after = text.slice(offset);
        const newRange = document.createRange();
        newRange.setStart(textNode, at);
        newRange.setEnd(textNode, offset);
        sel.removeAllRanges();
        sel.addRange(newRange);
        const replacedRange = newRange;
        replacedRange.deleteContents();

        const span = document.createElement("span");
        span.setAttribute("contenteditable", "false");
        span.setAttribute("data-mention", noteName);
        span.className = "mention-token";
        span.textContent = `@${noteName}`;
        span.addEventListener("click", () => {
          alert("would navigate to: " + noteName);
        });

        replacedRange.insertNode(span);
        const space = document.createTextNode("\u00A0");
        const afterRange = document.createRange();
        afterRange.setStartAfter(span);
        afterRange.setEndAfter(span);
        afterRange.insertNode(space);

        const finalRange = document.createRange();
        finalRange.setStartAfter(space);
        finalRange.setEndAfter(space);
        sel.removeAllRanges();
        sel.addRange(finalRange);
      }
    }

    closeMention();
    editor.normalize();
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const handleDropdownClick = (noteName) => {
    acceptMention(noteName);
    editorRef.current && editorRef.current.focus();
  };

  const handleKeyDownDropdown = (e, idx) => {
    if (e.key === "Enter") {
      e.preventDefault();
      acceptMention(mention.results[idx]);
    }
  };

  const handleSerialize = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const text = serializeEditor(editor);
    setSerializedText(text);
  };

  const serializeEditor = (root) => {
    let out = "";
    const walk = (node) => {
      node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          let t = child.nodeValue || "";
          t = t.replace(/\u00A0/g, " ");
          out += t;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (
            child.getAttribute &&
            child.getAttribute("data-mention") !== null
          ) {
            const name = child.getAttribute("data-mention");
            out += `@${name}`;
          } else if (child.tagName === "BR" || child.tagName === "DIV") {
            out += "\n";
            walk(child);
          } else {
            walk(child);
          }
        }
      });
    };
    walk(root);
    return out;
  };

  const deserializeText = (text) => {
    const parts = [];
    const re = /@(\w+)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push({ type: "text", value: text.slice(last, m.index) });
      parts.push({ type: "mention", value: m[1] });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ type: "text", value: text.slice(last) });

    const frag = document.createDocumentFragment();
    parts.forEach((p) => {
      if (p.type === "text") {
        frag.appendChild(document.createTextNode(p.value));
      } else {
        const span = document.createElement("span");
        span.setAttribute("contenteditable", "false");
        span.setAttribute("data-mention", p.value);
        span.className = "mention-token";
        span.textContent = `@${p.value}`;
        span.addEventListener("click", () => {
          alert("would navigate to: " + p.value);
        });
        frag.appendChild(span);
      }
    });
    return frag;
  };

  const handleLoadIntoEditor = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = "";
    const frag = deserializeText(loadInput);
    editor.appendChild(frag);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const handleClear = () => {
    const editor = editorRef.current;
    if (editor) {
      editor.innerHTML = "";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const handlePaste = (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
      }
    };
    editor.addEventListener("paste", handlePaste);
    return () => editor.removeEventListener("paste", handlePaste);
  }, []);

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Dev Mention Test (isolated)</h1>
      <p style={{ color: "#666", fontSize: 13, marginBottom: 16 }}>
        Type <code>@</code> to trigger the dropdown. Arrow keys + Enter to pick.
        Click a mention to "navigate". Backspace deletes whole mention.
      </p>

      <div style={{ position: "relative", marginBottom: 16 }}>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          style={{
            minHeight: 160,
            border: "1px solid #ccc",
            borderRadius: 6,
            padding: 12,
            outline: "none",
            lineHeight: 1.5,
            fontSize: 15,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        />

        {mention.open && mention.results.length > 0 && (
          <div
            ref={dropdownRef}
            style={{
              position: "absolute",
              top: 40,
              left: 12,
              background: "white",
              border: "1px solid #ccc",
              borderRadius: 6,
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              zIndex: 10,
              minWidth: 160,
            }}
          >
            {mention.results.map((name, idx) => (
              <div
                key={name}
                role="option"
                aria-selected={mention.activeIndex === idx}
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleDropdownClick(name);
                }}
                onKeyDown={(e) => handleKeyDownDropdown(e, idx)}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  background: mention.activeIndex === idx ? "#e6f0ff" : "white",
                  fontWeight: mention.activeIndex === idx ? 600 : 400,
                  fontSize: 14,
                  borderBottom: idx < mention.results.length - 1 ? "1px solid #eee" : "none",
                }}
              >
                @{name}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        <button onClick={handleSerialize} style={btn}>Show serialized text</button>
        <button onClick={handleClear} style={btn}>Clear editor</button>
        <button onClick={handleLoadIntoEditor} style={btn}>Load text into editor</button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          Serialized output (what would be saved):
        </div>
        <pre
          style={{
            background: "#f5f5f5",
            padding: 12,
            borderRadius: 6,
            whiteSpace: "pre-wrap",
            minHeight: 40,
            fontSize: 13,
            border: "1px solid #eaeaea",
          }}
        >
          {serializedText || "(click 'Show serialized text')"}
        </pre>
      </div>

      <div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          Load plain text into editor (paste @Mention text here, then click "Load"):
        </div>
        <textarea
          value={loadInput}
          onChange={(e) => setLoadInput(e.target.value)}
          style={{
            width: "100%",
            minHeight: 80,
            padding: 12,
            border: "1px solid #ccc",
            borderRadius: 6,
            fontFamily: "inherit",
            fontSize: 13,
            resize: "vertical",
          }}
          placeholder="e.g. Hello @Alpha, this links to @Beta and @Gamma."
        />
      </div>

      <style jsx global>{`
        .mention-token {
          background: #e6f0ff;
          color: #1a4fa8;
          border-radius: 4px;
          padding: 1px 4px;
          margin: 0 1px;
          cursor: pointer;
          user-select: none;
          font-weight: 500;
        }
      `}</style>
    </main>
  );
}

const btn = {
  padding: "8px 14px",
  border: "1px solid #ccc",
  borderRadius: 6,
  background: "#fafafa",
  cursor: "pointer",
  fontSize: 14,
};
