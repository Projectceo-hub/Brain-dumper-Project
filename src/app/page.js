"use client";

import { useCallback, useState, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

let nodeId = 0;
const getId = () => `node-${nodeId++}`;

// Custom node: a simple card that matches our design tokens
function ThoughtNode({ data }) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E4E4E7",
        borderRadius: "10px",
        padding: "12px 16px",
        minWidth: "160px",
        maxWidth: "260px",
        fontSize: "14px",
        color: "#18181B",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {data.label}
    </div>
  );
}

const nodeTypes = { thought: ThoughtNode };

const initialNodes = [];
const initialEdges = [];

export default function Home() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef(null);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const addNode = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    // Spawn near center-bottom, with slight random offset so nodes don't stack exactly
    const x = 300 + Math.random() * 400;
    const y = 200 + Math.random() * 200;

    const newNode = {
      id: getId(),
      type: "thought",
      position: { x, y },
      data: { label: trimmed },
    };

    setNodes((nds) => nds.concat(newNode));
    setInputValue("");
  }, [inputValue, setNodes]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addNode();
    }
  };

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#FAFAF9" }}>
      {/* Wordmark */}
      <div
        style={{
          position: "absolute",
          top: 20,
          left: 24,
          zIndex: 10,
          fontFamily: "Inter, sans-serif",
          fontWeight: 600,
          fontSize: "15px",
          color: "#18181B",
          letterSpacing: "-0.01em",
        }}
      >
        mindcanvas
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background color="#E4E4E7" gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* Floating quick-add bar */}
      <div
        style={{
          position: "absolute",
          bottom: 32,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: "#FFFFFF",
            border: "1px solid #E4E4E7",
            borderRadius: "999px",
            padding: "10px 10px 10px 20px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
            width: "480px",
            maxWidth: "90vw",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Dump a thought..."
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: "14px",
              fontFamily: "Inter, sans-serif",
              color: "#18181B",
              background: "transparent",
            }}
          />
          <button
            onClick={addNode}
            style={{
              background: "#92400E",
              color: "#FFFFFF",
              border: "none",
              borderRadius: "999px",
              padding: "8px 18px",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "Inter, sans-serif",
            }}
          >
            Add
          </button>
        </div>
        <span
          style={{
            fontSize: "11px",
            color: "#71717A",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
          }}
        >
          Enter to add · drag between nodes to connect
        </span>
      </div>
    </div>
  );
}
