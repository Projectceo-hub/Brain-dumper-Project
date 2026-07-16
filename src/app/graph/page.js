"use client";

import { useState, useEffect, useMemo, Suspense, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  Background,
  BackgroundVariant,
  Handle,
  Position
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  getNoteById,
  getChildNotes,
  getAllNotesWithFolders,
  getAllFolders,
  createNotesFromTree,
  saveEntities,
  getEntitiesForNoteTree,
  getEntitiesByNames,
  updateNote
} from "@/lib/db";

const ENTITY_ICONS = {
  person: "👤",
  company: "🏢",
  project: "📁",
};

function EntityNode({ data }) {
  const icon = ENTITY_ICONS[data.entityType] || "◆";
  return (
    <div className="flex flex-col items-center select-none relative">
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: "transparent",
          border: "none",
          width: 1,
          height: 1,
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />
      <div
        className="flex items-center justify-center shadow-md cursor-pointer hover:scale-110 transition-transform border-2 border-clay"
        style={{
          width: 36,
          height: 36,
          backgroundColor: "#C4571F22",
          transform: "rotate(45deg)",
          borderRadius: 4,
        }}
      >
        <span
          className="text-sm leading-none"
          style={{ transform: "rotate(-45deg)" }}
        >
          {icon}
        </span>
      </div>
      {data.label && (
        <span className="mt-2 whitespace-nowrap text-[9px] font-sans text-clay pointer-events-none max-w-[80px] truncate">
          {data.label}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: "transparent",
          border: "none",
          width: 1,
          height: 1,
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}

// 1. Custom Flat Dot Node (for Global Obsidian View)
function DotNode({ data }) {
  return (
    <div className="flex flex-col items-center select-none relative">
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: "transparent",
          border: "none",
          width: 1,
          height: 1,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />
      <div
        className="rounded-full shadow-sm cursor-pointer hover:scale-110 transition-transform"
        style={{
          width: data.dotSize || 10,
          height: data.dotSize || 10,
          backgroundColor: data.color || "#8A8071",
        }}
      />
      {data.label && (
        <span
          className="mt-1 whitespace-nowrap text-[9px] font-sans text-warm-gray pointer-events-none"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          {data.label}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: "transparent",
          border: "none",
          width: 1,
          height: 1,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}

// 2. Custom Pill Node (for NotebookLM Mindmap View)
function PillNode({ data }) {
  return (
    <div className="bg-ink border border-graph-line rounded-lg px-4 py-2 shadow-lg relative min-w-[120px] max-w-[200px] text-center flex items-center justify-center cursor-pointer hover:border-clay transition-colors">
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: "#C4571F",
          border: "none",
          width: 6,
          height: 6,
          borderRadius: "50%",
          left: "-3px",
        }}
      />
      <span className="text-bone font-sans text-xs font-semibold leading-tight select-none">
        {data.label}
      </span>
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: "#3D6B5C",
          border: "none",
          width: 6,
          height: 6,
          borderRadius: "50%",
          right: "-3px",
        }}
      />
    </div>
  );
}

// Client-side parser that converts a note's text content into a mindmap tree (Fallback)
function parseNoteToMindmap(title, body) {
  const root = { label: title || "Untitled Note", children: [] };
  if (!body || !body.trim()) {
    root.children.push({ label: "Empty note content", children: [] });
    return root;
  }

  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);

  let currentSection = null;
  let currentListParent = null;

  lines.forEach((line) => {
    // Headers (e.g., # Header, ## Header)
    const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      const text = headerMatch[2];
      const node = { label: text, children: [] };
      root.children.push(node);
      currentSection = node;
      currentListParent = null;
      return;
    }

    // List items (e.g., - Item, * Item, 1. Item)
    const listMatch = line.match(/^[-*+•]\s+(.*)$/) || line.match(/^\d+\.\s+(.*)$/);
    if (listMatch) {
      const text = listMatch[1];
      const node = { label: text, children: [] };
      if (currentSection) {
        currentSection.children.push(node);
      } else {
        root.children.push(node);
      }
      currentListParent = node;
      return;
    }

    // Plain text / sentences
    const cleanLine = line.replace(/[#*_\-`]/g, "").trim();
    if (!cleanLine) return;

    const labelText = cleanLine.length > 50 ? cleanLine.slice(0, 50) + "..." : cleanLine;
    const node = { label: labelText, children: [] };

    if (currentListParent) {
      currentListParent.children.push(node);
    } else if (currentSection) {
      currentSection.children.push(node);
    } else {
      root.children.push(node);
    }
  });

  // Fallback paragraph parser if no list/headers found
  if (root.children.length === 0) {
    const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    paragraphs.forEach((p) => {
      const cleanP = p.replace(/[#*_\-`]/g, "").trim();
      if (!cleanP) return;

      const sentences = cleanP.split(/(?<=[.!?])\s+/);
      const first = sentences[0];
      const rest = sentences.slice(1).join(" ");

      const labelText = first.length > 50 ? first.slice(0, 50) + "..." : first;
      const node = { label: labelText, children: [] };
      if (rest) {
        node.children.push({
          label: rest.length > 60 ? rest.slice(0, 60) + "..." : rest,
          children: [],
        });
      }
      root.children.push(node);
    });
  }

  return root;
}

// Recursively fetch all children notes from the database to build a complete tree
async function fetchDescendantTree(parentNoteId) {
  const children = await getChildNotes(parentNoteId);
  const results = [];

  for (const child of children) {
    const grandchildren = await fetchDescendantTree(child.id);
    results.push({
      id: child.id,
      title: child.title,
      body: child.body,
      entityRefs: child.entityRefs || [],
      children: grandchildren,
    });
  }
  return results;
}

function GraphContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const noteId = searchParams.get("note");

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [aiMapping, setAiMapping] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [selectedNote, setSelectedNote] = useState(null);
  const [selectedEntity, setSelectedEntity] = useState(null);

  const velocities = useRef({});
  const nodeTypes = useMemo(
    () => ({ dot: DotNode, pill: PillNode, entity: EntityNode }),
    []
  );

  // 1. Initial Data Loading & Tree Construction
  useEffect(() => {
    async function loadGraphData() {
      setLoading(true);
      try {
        if (noteId) {
          // ----------------------------------------------------
          // NOTE MINDMAP (NotebookLM Style representation)
          // ----------------------------------------------------
          const rootNote = await getNoteById(noteId);
          if (!rootNote) {
            router.push("/");
            return;
          }
          setNoteTitle(rootNote.title || "Untitled Note");

          // Check if children exist in IndexedDB
          let dbChildren = await getChildNotes(rootNote.id);

          // If no children exist, trigger AI organizer (or fallback to client parsing)
          if (dbChildren.length === 0) {
            setAiMapping(true);
            try {
              const res = await fetch("/api/organize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: rootNote.body || rootNote.title }),
              });

              if (res.ok) {
                const data = await res.json();
                if (data && data.tree && Array.isArray(data.tree.children)) {
                  if (Array.isArray(data.entities) && data.entities.length > 0) {
                    await saveEntities(data.entities, rootNote.id);
                  }
                  for (const child of data.tree.children) {
                    await createNotesFromTree(rootNote.folderId, child, rootNote.id);
                  }
                  if (data.tree.entityRefs?.length) {
                    await updateNote(rootNote.id, {
                      entityRefs: data.tree.entityRefs,
                    });
                  }
                }
              } else {
                throw new Error("AI organize call failed");
              }
            } catch (err) {
              console.warn("AI mapping failed, falling back to local text parser:", err);
              // Fallback: parse note locally and seed children in IndexedDB
              const localTree = parseNoteToMindmap(rootNote.title, rootNote.body);
              if (Array.isArray(localTree.children)) {
                for (const child of localTree.children) {
                  await createNotesFromTree(rootNote.folderId, child, rootNote.id);
                }
              }
            } finally {
              setAiMapping(false);
            }
          }

          // Fetch full hierarchical descendant tree
          const descendants = await fetchDescendantTree(rootNote.id);
          const fullTree = {
            id: rootNote.id,
            title: rootNote.title || "Untitled",
            body: rootNote.body,
            entityRefs: rootNote.entityRefs || [],
            children: descendants,
          };

          const newNodes = [];
          const newEdges = [];
          const entityNodeIds = new Map();

          function buildHorizontalGraph(node, depth = 0, parentId = null, px = 100, py = 300, siblingIndex = 0, totalSiblings = 1) {
            const currentId = `note-${node.id}`;

            const spacingY = 90;
            const startY = py - ((totalSiblings - 1) * spacingY) / 2;
            const y = startY + siblingIndex * spacingY;
            const x = 100 + depth * 280;

            newNodes.push({
              id: currentId,
              type: "pill",
              position: { x, y },
              data: {
                label: node.title || "Untitled",
                title: node.title || "Untitled",
                body: node.body || "",
                entityRefs: node.entityRefs || [],
              },
            });

            if (parentId) {
              newEdges.push({
                id: `edge-${parentId}-${currentId}`,
                source: parentId,
                target: currentId,
                type: "bezier",
                style: { stroke: "#3A352C", strokeWidth: 1.5 },
              });
            }

            if (Array.isArray(node.children)) {
              const count = node.children.length;
              node.children.forEach((child, idx) => {
                buildHorizontalGraph(child, depth + 1, currentId, x, y, idx, count);
              });
            }
          }

          buildHorizontalGraph(fullTree, 0, null, 100, 300, 0, 1);

          const treeEntities = await getEntitiesForNoteTree(rootNote.id);
          treeEntities.forEach((entity, idx) => {
            const entityNodeId = `entity-${entity.id}`;
            entityNodeIds.set(entity.name, entityNodeId);
            newNodes.push({
              id: entityNodeId,
              type: "entity",
              position: { x: 40, y: 120 + idx * 70 },
              data: {
                label: entity.name,
                title: entity.name,
                body: `${entity.type.charAt(0).toUpperCase()}${entity.type.slice(1)} entity`,
                entityType: entity.type,
                isEntity: true,
              },
            });
          });

          newNodes.forEach((node) => {
            if (node.type !== "pill" || !node.data.entityRefs?.length) return;
            node.data.entityRefs.forEach((refName) => {
              const entityNodeId = entityNodeIds.get(refName);
              if (!entityNodeId) return;
              newEdges.push({
                id: `edge-${node.id}-${entityNodeId}`,
                source: node.id,
                target: entityNodeId,
                type: "bezier",
                style: { stroke: "#C4571F", strokeWidth: 1, strokeDasharray: "4 4" },
              });
            });
          });

          setNodes(newNodes);
          setEdges(newEdges);
        } else {
          // ----------------------------------------------------
          // GLOBAL GRAPH (Second Brain: Radial Layout)
          // ----------------------------------------------------
          const foldersList = await getAllFolders();
          const notesList = await getAllNotesWithFolders();

          const newNodes = [];
          const newEdges = [];

          const centerX = 500;
          const centerY = 500;

          // "You" center node
          newNodes.push({
            id: "you",
            type: "dot",
            position: { x: centerX, y: centerY },
            data: {
              label: "You",
              color: "#ffffff",
              dotSize: 16,
            },
          });

          // Ring 1 (folders)
          const ring1Radius = 200;
          const folderCount = foldersList.length;

          foldersList.forEach((folder, folderIdx) => {
            const angle = (folderIdx / folderCount) * 2 * Math.PI;
            const fx = centerX + ring1Radius * Math.cos(angle);
            const fy = centerY + ring1Radius * Math.sin(angle);

            const color = folderIdx % 2 === 0 ? "#C4571F" : "#3D6B5C";

            newNodes.push({
              id: `folder-${folder.id}`,
              type: "dot",
              position: { x: fx, y: fy },
              data: {
                label: folder.name,
                color: color,
                dotSize: 12,
              },
            });

            newEdges.push({
              id: `edge-you-folder-${folder.id}`,
              source: "you",
              target: `folder-${folder.id}`,
              type: "straight",
              style: { stroke: "#3A352C", strokeWidth: 1 },
            });

            // Ring 2 (notes around their respective folders)
            const folderNotes = notesList.filter((n) => n.folderId === folder.id);
            const noteCount = folderNotes.length;
            const ring2Radius = 80;

            folderNotes.forEach((note, noteIdx) => {
              const noteAngle = (noteIdx / noteCount) * 2 * Math.PI;
              const nx = fx + ring2Radius * Math.cos(noteAngle);
              const ny = fy + ring2Radius * Math.sin(noteAngle);

              newNodes.push({
                id: `note-${note.id}`,
                type: "dot",
                position: { x: nx, y: ny },
                data: {
                  label: note.title || "Untitled",
                  color: color,
                  dotSize: 9,
                  title: note.title || "Untitled",
                  body: note.body || "",
                },
              });

              newEdges.push({
                id: `edge-folder-${folder.id}-note-${note.id}`,
                source: `folder-${folder.id}`,
                target: `note-${note.id}`,
                type: "straight",
                style: { stroke: "#3A352C", strokeWidth: 1 },
              });
            });
          });

          setNodes(newNodes);
          setEdges(newEdges);
        }
      } catch (err) {
        console.error("Failed to load graph data:", err);
      } finally {
        setLoading(false);
      }
    }

    loadGraphData();
  }, [noteId]);

  // 2. Physics simulation engine (Obsidian force-directed float/bounce logic)
  // DISABLE PHYSICS ENTIRELY FOR PER-NOTE MINDMAP to keep clean horizontal alignment
  useEffect(() => {
    if (loading || nodes.length === 0) return;
    if (noteId) return; // Statically anchor the mindmap blocks!

    let animId;
    const center = { x: 500, y: 500 };

    const updatePhysics = () => {
      setNodes((currentNodes) => {
        const posMap = {};
        currentNodes.forEach((n) => {
          posMap[n.id] = { x: n.position.x, y: n.position.y };
        });

        currentNodes.forEach((n) => {
          if (!velocities.current[n.id]) {
            velocities.current[n.id] = { x: 0, y: 0 };
          }
        });

        const forces = {};
        currentNodes.forEach((n) => {
          forces[n.id] = { x: 0, y: 0 };
        });

        // Repulsion
        for (let i = 0; i < currentNodes.length; i++) {
          const u = currentNodes[i];
          for (let j = i + 1; j < currentNodes.length; j++) {
            const v = currentNodes[j];

            const dx = posMap[u.id].x - posMap[v.id].x;
            const dy = posMap[u.id].y - posMap[v.id].y;
            const distSq = dx * dx + dy * dy + 0.1;
            const dist = Math.sqrt(distSq);

            if (dist < 300) {
              const force = 2500 / distSq;
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;

              forces[u.id].x += fx;
              forces[u.id].y += fy;
              forces[v.id].x -= fx;
              forces[v.id].y -= fy;
            }
          }
        }

        // Attraction
        edges.forEach((edge) => {
          const uId = edge.source;
          const vId = edge.target;

          if (posMap[uId] && posMap[vId]) {
            const dx = posMap[vId].x - posMap[uId].x;
            const dy = posMap[vId].y - posMap[uId].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;

            const desiredDist = 100;
            const force = (dist - desiredDist) * 0.04;

            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            forces[uId].x += fx;
            forces[uId].y += fy;
            forces[vId].x -= fx;
            forces[vId].y -= fy;
          }
        });

        // Pull to center
        currentNodes.forEach((n) => {
          const dx = center.x - posMap[n.id].x;
          const dy = center.y - posMap[n.id].y;
          forces[n.id].x += dx * 0.003;
          forces[n.id].y += dy * 0.003;
        });

        const nextNodes = currentNodes.map((n) => {
          if (n.dragging) {
            velocities.current[n.id] = { x: 0, y: 0 };
            return n;
          }

          const v = velocities.current[n.id];
          const f = forces[n.id];

          v.x = (v.x + f.x) * 0.84;
          v.y = (v.y + f.y) * 0.84;

          const speed = Math.sqrt(v.x * v.x + v.y * v.y);
          if (speed > 12) {
            v.x = (v.x / speed) * 12;
            v.y = (v.y / speed) * 12;
          }

          return {
            ...n,
            position: {
              x: posMap[n.id].x + v.x,
              y: posMap[n.id].y + v.y,
            },
          };
        });

        return nextNodes;
      });

      animId = requestAnimationFrame(updatePhysics);
    };

    animId = requestAnimationFrame(updatePhysics);
    return () => cancelAnimationFrame(animId);
  }, [loading, edges, setNodes, noteId]);

  // Click on a node opens the side panel displaying details
  const onNodeClick = (event, node) => {
    if (node.data?.isEntity) {
      setSelectedEntity({
        name: node.data.title || node.data.label,
        type: node.data.entityType || "entity",
        description: node.data.body || "",
      });
      setSelectedNote(null);
      return;
    }
    if (node.data && (node.data.title || node.data.body)) {
      setSelectedNote({
        title: node.data.title || "Untitled",
        body: node.data.body || "",
      });
      setSelectedEntity(null);
    }
  };

  return (
    <div className="w-screen h-screen bg-graph-bg relative select-none">
      {/* Header Overlay */}
      <header className="fixed top-0 left-0 right-0 z-10 flex items-center gap-3 px-5 pt-5 pointer-events-none">
        <button
          onClick={() => {
            if (noteId && nodes.length > 0) {
              getNoteById(noteId).then((note) => {
                if (note) {
                  router.push(`/folder/${note.folderId}`);
                } else {
                  router.push("/");
                }
              });
            } else {
              router.push("/");
            }
          }}
          className="w-8 h-8 rounded-full bg-ink/75 flex items-center justify-center cursor-pointer text-bone text-base border border-graph-line/40 hover:bg-ink pointer-events-auto transition-colors"
        >
          ←
        </button>
        <div className="flex flex-col pointer-events-auto bg-graph-bg/50 px-2 py-0.5 rounded">
          <h1 className="font-serif text-bone text-lg font-bold">
            {noteId ? "Note map" : "Second brain"}
          </h1>
          {noteId && noteTitle && (
            <p className="text-[11px] font-sans text-warm-gray">{noteTitle}</p>
          )}
        </div>
      </header>

      {/* Main Graph Canvas */}
      {loading || aiMapping ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-graph-bg gap-3">
          <p className="font-sans text-warm-gray animate-pulse">
            {aiMapping
              ? "AI is mapping this note into a structured mindmap..."
              : "Loading visual brain..."}
          </p>
        </div>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          fitView
          panOnDrag
          zoomOnPinch
          zoomOnScroll
          minZoom={0.1}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
          style={{ background: "#14110D" }}
        >
          <Background variant={BackgroundVariant.Dots} color="#3A352C" size={1} gap={24} />
        </ReactFlow>
      )}

      {/* Slide-out Sidebar Panel */}
      {(selectedNote || selectedEntity) && (
        <div className="fixed top-0 right-0 h-full w-[350px] bg-ink border-l border-graph-line z-30 shadow-2xl p-6 text-bone flex flex-col transition-all duration-300 animate-slide-in-right">
          <div className="flex items-center justify-between">
            <span className="text-warm-gray-light font-sans text-xs uppercase tracking-widest font-semibold">
              {selectedEntity ? "Entity" : "Content Details"}
            </span>
            <button
              onClick={() => {
                setSelectedNote(null);
                setSelectedEntity(null);
              }}
              className="text-warm-gray hover:text-bone text-2xl font-sans cursor-pointer focus:outline-none"
            >
              &times;
            </button>
          </div>
          {selectedEntity ? (
            <>
              <div className="mt-4 flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center border-2 border-clay"
                  style={{ transform: "rotate(45deg)", borderRadius: 4, backgroundColor: "#C4571F22" }}
                >
                  <span style={{ transform: "rotate(-45deg)" }}>
                    {ENTITY_ICONS[selectedEntity.type] || "◆"}
                  </span>
                </div>
                <div>
                  <h2 className="font-serif text-2xl font-bold text-bone leading-tight">
                    {selectedEntity.name}
                  </h2>
                  <p className="font-sans text-xs text-clay capitalize mt-0.5">
                    {selectedEntity.type}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <>
              <h2 className="font-serif text-2xl font-bold text-bone mt-2 border-b border-graph-line pb-3 leading-tight">
                {selectedNote.title}
              </h2>
              <div className="font-sans text-sm text-warm-gray-light leading-relaxed mt-4 flex-1 overflow-y-auto whitespace-pre-wrap pr-1 scrollbar-thin">
                {selectedNote.body || (
                  <span className="italic text-warm-gray">No description available.</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function GraphPage() {
  return (
    <Suspense
      fallback={
        <div className="w-screen h-screen flex items-center justify-center bg-graph-bg">
          <p className="font-sans text-warm-gray animate-pulse">Loading visual brain...</p>
        </div>
      }
    >
      <GraphContent />
    </Suspense>
  );
}
