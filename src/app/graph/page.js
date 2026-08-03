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
import { X } from "lucide-react";

import {
  getNoteById,
  getChildNotes,
  getAllNotesWithFolders,
  getAllFolders,
  createNotesFromTree,
  saveEntities,
  getEntitiesForNoteTree,
  getEntitiesByNames,
  updateNote,
  getAllNoteLinks
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
        className="flex cursor-pointer items-center justify-center shadow-md transition-transform hover:scale-110 border-2 border-[#7A8E5D]"
        style={{
          width: 36,
          height: 36,
          backgroundColor: "rgba(122, 142, 93, 0.16)",
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
        <span className="pointer-events-none mt-2 max-w-[80px] truncate whitespace-nowrap text-[9px] text-[#A8BC8B]">
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

// 1. Orb node for the global "second brain" view.
//
// The Phase 7B pass briefly rendered notes as white rectangle cards. That
// was reverted: the cards were ~150px wide and opaque, and because React
// Flow paints the edge SVG *beneath* the node layer, every edge — including
// the sage @mention links from Phase 7A — ran centre-to-centre underneath
// the cards and was completely hidden. Small orbs restore the original
// visual AND make the edges visible again, which is why one change fixes
// both. The title stays as small text under the orb, with a native tooltip
// carrying the full title + space on hover.
function DotNode({ data }) {
  const size = data.dotSize || 10;
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
        title={
          data.spaceName
            ? `${data.title || data.label} — ${data.spaceName}`
            : data.label
        }
        className="rounded-full shadow-sm cursor-pointer hover:scale-125 transition-transform"
        style={{
          width: size,
          height: size,
          backgroundColor: data.color || "#8B877E",
        }}
      />
      {data.label && (
        <span
          className="pointer-events-none mt-1 max-w-[120px] truncate whitespace-nowrap text-[9px] text-[#8B877E]"
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
    <div className="relative flex min-w-[120px] max-w-[200px] cursor-pointer items-center justify-center rounded-[20px] border border-[#2E2E2E] bg-[#1E1E1E] px-4 py-2 text-center shadow-lg transition-colors hover:border-[#7A8E5D]">
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: "#7A8E5D",
          border: "none",
          width: 6,
          height: 6,
          borderRadius: "50%",
          left: "-3px",
        }}
      />
      <span className="select-none text-[12px] font-medium leading-tight text-white">
        {data.label}
      </span>
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: "#A8BC8B",
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
                style: { stroke: "#2E2E2E", strokeWidth: 1.5 },
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
          // Seed radius only — the physics pass below is what actually
          // spreads the graph. Kept generous so nodes don't all start on
          // top of each other and need many frames to separate.
          const ring1Radius = 420;
          const folderCount = foldersList.length;

          foldersList.forEach((folder, folderIdx) => {
            const angle = (folderIdx / folderCount) * 2 * Math.PI;
            const fx = centerX + ring1Radius * Math.cos(angle);
            const fy = centerY + ring1Radius * Math.sin(angle);

            const color = folderIdx % 2 === 0 ? "#7A8E5D" : "#A8BC8B";

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
              style: { stroke: "#2E2E2E", strokeWidth: 1 },
            });

            // Ring 2 (notes around their respective folders)
            const folderNotes = notesList.filter((n) => n.folderId === folder.id);
            const noteCount = folderNotes.length;
            const ring2Radius = 170;

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
                  // Note orbs are always sage; the folder ring keeps the
                  // alternating palette so the hierarchy still reads.
                  color: "#7A8E5D",
                  dotSize: 9,
                  title: note.title || "Untitled",
                  spaceName: folder.name,
                  folderId: folder.id,
                  body: note.body || "",
                },
              });

              newEdges.push({
                id: `edge-folder-${folder.id}-note-${note.id}`,
                source: `folder-${folder.id}`,
                target: `note-${note.id}`,
                type: "straight",
                style: { stroke: "#2E2E2E", strokeWidth: 1 },
              });
            });
          });

          // Phase 7A: note <-> note link edges from note_links.
          const nodeIds = new Set(newNodes.map((n) => n.id));
          const seenLinkEdgeIds = new Set();
          let noteLinks = [];
          try {
            noteLinks = await getAllNoteLinks();
          } catch (err) {
            console.warn("Failed to load note links for graph:", err);
          }

          for (const link of noteLinks || []) {
            if (!link || !link.source_note_id || !link.target_note_id) continue;

            const source = `note-${link.source_note_id}`;
            const target = `note-${link.target_note_id}`;

            // Skip silently when either endpoint isn't on screen: the note
            // was deleted after the link was written, lives outside this
            // user's set, or simply isn't rendered.
            if (!nodeIds.has(source) || !nodeIds.has(target)) continue;

            const id = `edge-${link.source_note_id}-${link.target_note_id}`;
            if (seenLinkEdgeIds.has(id)) continue;
            seenLinkEdgeIds.add(id);

            newEdges.push({
              id,
              source,
              target,
              type: "default",
              animated: false,
              style: { stroke: "#7A8E5D", strokeWidth: 1.5, opacity: 0.6 },
            });
          }

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

            // CLUSTERING FIX: the old values were tuned for a handful of
            // nodes — repulsion only acted within 300px and was weak
            // (2500/d²), so with dozens of notes the centre pull and the
            // edge springs overwhelmed it and everything collapsed into a
            // ball. Longer range + a much larger constant lets the graph
            // actually occupy the canvas.
            if (dist < 900) {
              const force = 45000 / distSq;
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

            // Longer rest length and a softer spring, so linked notes stay
            // visibly connected without dragging the graph back into a knot.
            const desiredDist = 190;
            const force = (dist - desiredDist) * 0.022;

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
          forces[n.id].x += dx * 0.0012;
          forces[n.id].y += dy * 0.0012;
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
      // Resolve the note's @mention-linked neighbours from the edges that
      // Phase 7A already built, so the preview can list them as chips.
      // Reads existing state only — no new queries.
      const nodeId = node.id;
      const linkedIds = edges
        .filter((e) => e.id.startsWith("edge-") && !e.id.startsWith("edge-you"))
        .filter((e) => e.source === nodeId || e.target === nodeId)
        .map((e) => (e.source === nodeId ? e.target : e.source))
        .filter((id) => id.startsWith("note-"));

      const links = [...new Set(linkedIds)]
        .map((id) => nodes.find((n) => n.id === id))
        .filter(Boolean)
        .map((n) => ({
          id: n.id.replace(/^note-/, ""),
          title: n.data.title,
          folderId: n.data.folderId,
        }));

      setSelectedNote({
        id: nodeId.replace(/^note-/, ""),
        title: node.data.title || "Untitled",
        body: node.data.body || "",
        spaceName: node.data.spaceName || "",
        folderId: node.data.folderId,
        links,
      });
      setSelectedEntity(null);
    }
  };

  return (
    <div className="relative h-screen w-screen select-none" style={{ background: "var(--dark-surface)" }}>
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
          className="pointer-events-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-[#1E1E1E] text-white transition-colors hover:bg-[#2A2A2A]"
        >
          ←
        </button>
        <div className="pointer-events-auto flex flex-1 items-start justify-between">
          <div>
            <h1 className="mc-display text-[20px] text-white">
              {noteId ? "Note map" : "Graph View"}
            </h1>
            <p className="mt-0.5 text-[12px] text-white/50">
              {noteId && noteTitle
                ? noteTitle
                : `${nodes.filter((n) => n.id.startsWith("note-")).length} notes • green lines are @mention links`}
            </p>
          </div>
          {!noteId && (
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/40">
              • Live links
            </span>
          )}
        </div>
      </header>

      {/* Main Graph Canvas */}
      {loading || aiMapping ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ background: "var(--dark-surface)" }}>
          <p className="animate-pulse text-[14px] text-[#8B877E]">
            {aiMapping
              ? "AI is mapping this note into a structured mindmap..."
              : "Loading visual brain..."}
          </p>
        </div>
      ) : (
        // Graph canvas fade-in: all nodes/edges snap into place, but the
        // visual layer fades from 0→1 so the user sees a smooth reveal.
        <div className="route-enter w-full h-full">
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
            style={{ background: "var(--dark-surface)" }}
          >
            <Background variant={BackgroundVariant.Dots} color="#2E2E2E" size={1} gap={24} />
          </ReactFlow>
        </div>
      )}

      {/* Node preview panel: full-width above the nav on phone, anchored
          bottom-left on desktop (per the reference). */}
      {(selectedNote || selectedEntity) && (
        <div className="mc-graph-panel fixed bottom-24 left-4 right-4 z-30 lg:bottom-6 lg:left-6 lg:right-auto lg:w-[520px]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {selectedEntity ? (
                <>
                  <div className="text-[14px] font-medium" style={{ color: "var(--text-strong)" }}>
                    {selectedEntity.name}
                  </div>
                  <div className="mt-0.5 text-[12px] capitalize" style={{ color: "var(--text-dim)" }}>
                    {selectedEntity.type}
                  </div>
                </>
              ) : (
                <>
                  <div className="truncate text-[14px] font-medium" style={{ color: "var(--text-strong)" }}>
                    {selectedNote.title || "Untitled"}
                  </div>
                  <div className="mt-0.5 text-[12px]" style={{ color: "var(--text-dim)" }}>
                    {selectedNote.spaceName || "Space"}
                    {selectedNote.links && selectedNote.links.length > 0
                      ? ` • ${selectedNote.links.length} ${selectedNote.links.length === 1 ? "link" : "links"}`
                      : ""}
                  </div>

                  {selectedNote.links && selectedNote.links.length > 0 && (
                    <div
                      className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]"
                      style={{ color: "var(--text-body)" }}
                    >
                      <span>Linked via</span>
                      {selectedNote.links.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => router.push(`/folder/${l.folderId}?note=${l.id}`)}
                          className="mc-mention"
                        >
                          {l.title || "Untitled"}
                        </button>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      router.push(`/folder/${selectedNote.folderId}?note=${selectedNote.id}`)
                    }
                    className="mc-link mt-3 block"
                  >
                    Open note &rarr;
                  </button>
                </>
              )}
            </div>
            <button
              onClick={() => {
                setSelectedNote(null);
                setSelectedEntity(null);
              }}
              aria-label="Close preview"
              className="shrink-0 transition-colors"
              style={{ color: "var(--text-dim)" }}
            >
              <X size={16} strokeWidth={1.8} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GraphPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center" style={{ background: "var(--dark-surface)" }}>
          <p className="animate-pulse text-[14px] text-[#8B877E]">Loading visual brain…</p>
        </div>
      }
    >
      <GraphContent />
    </Suspense>
  );
}
