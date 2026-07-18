import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { createTokenForUser, listTokensForUser } from "@/lib/mcp/auth";

// GET /api/tokens — list the current user's API tokens (never returns raw token values).
export async function GET() {
  try {
    const { supabase, user } = await getAuthenticatedUser();
    if (!supabase || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tokens = await listTokensForUser(user.id);
    return NextResponse.json({ tokens });
  } catch (error) {
    console.error("List tokens error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/tokens — generate a new API token for the current user.
// Body: { label?: string }
// Returns: { token: "<raw token shown exactly once>", label, tokenPrefix }
// After this response the raw token is never retrievable again.
export async function POST(request) {
  try {
    const { supabase, user } = await getAuthenticatedUser();
    if (!supabase || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let label = "default";
    try {
      const body = await request.json();
      if (body && typeof body.label === "string" && body.label.trim()) {
        label = body.label.trim().slice(0, 60);
      }
    } catch {
      // Empty body / invalid JSON — fall back to default label.
    }

    const created = await createTokenForUser(user.id, label);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("Create token error:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
