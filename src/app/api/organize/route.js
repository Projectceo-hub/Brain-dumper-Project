import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are a knowledge organizer. Analyze the user's brain dump and extract structured information.

Return ONLY valid JSON with this exact structure:
{
  "title": "A concise title summarizing the brain dump",
  "entities": [
    { "name": "Real Person/Company/Project Name", "type": "person|company|project" }
  ],
  "tree": {
    "label": "Root topic label",
    "note": "Detailed note content for this node",
    "entityRefs": ["Names from entities that relate to this node"],
    "children": [
      {
        "label": "Subtopic label",
        "note": "Detailed note content",
        "entityRefs": [],
        "children": []
      }
    ]
  }
}

Rules:
- Extract REAL named entities (actual people, companies, projects mentioned) — not generic topic labels.
- Preserve the natural hierarchy from the input — if someone describes a chain of command, subtasks, or nested structure, reflect that depth in the tree.
- Tree depth is unlimited — create as many levels as the content warrants. Do not flatten it.
- Every node MUST have all four fields: label, note, entityRefs, children.
- Return ONLY the JSON object, no markdown formatting, no code fences.`;

function normalizeTree(node) {
  if (!node || typeof node !== "object") {
    return { label: "Untitled", note: "", entityRefs: [], children: [] };
  }
  return {
    label: typeof node.label === "string" ? node.label : "Untitled",
    note: typeof node.note === "string" ? node.note : "",
    entityRefs: Array.isArray(node.entityRefs) ? node.entityRefs : [],
    children: Array.isArray(node.children)
      ? node.children.map(normalizeTree)
      : [],
  };
}

export async function POST(request) {
  try {
    const { text } = await request.json();

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "NVIDIA API key not configured in environment" },
        { status: 500 }
      );
    }

    const response = await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "nvidia/nemotron-3-ultra-550b-a55b",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: text },
          ],
          temperature: 0.3,
          max_tokens: 4096,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("NVIDIA API failed:", response.status, errText);
      return NextResponse.json(
        { error: "AI service returned an error" },
        { status: 502 }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Empty message content returned from NVIDIA NIM");
    }

    // Strip code fences if the AI returned them
    let raw = content.trim();
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseError) {
      console.error("Failed to parse JSON response from AI:", raw, parseError);
      // Fallback response using the input text
      parsed = {
        title: text.slice(0, 50),
        entities: [],
        tree: {
          label: "Brain Dump",
          note: text,
          entityRefs: [],
          children: [],
        },
      };
    }

    // Defensive Normalization
    const normalized = {
      title:
        typeof parsed.title === "string" ? parsed.title : text.slice(0, 50),
      entities: Array.isArray(parsed.entities)
        ? parsed.entities.filter(
            (e) =>
              e && typeof e.name === "string" && typeof e.type === "string"
          )
        : [],
      tree: normalizeTree(parsed.tree),
    };

    return NextResponse.json(normalized);
  } catch (error) {
    console.error("Internal Server Error in Organize Route:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}