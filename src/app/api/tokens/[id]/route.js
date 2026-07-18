import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { revokeToken } from "@/lib/mcp/auth";

// DELETE /api/tokens/[id] — revoke one of the current user's tokens.
export async function DELETE(request, { params }) {
  try {
    const { supabase, user } = await getAuthenticatedUser();
    if (!supabase || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tokenId = params?.id;
    if (!tokenId) {
      return NextResponse.json({ error: "Token id required" }, { status: 400 });
    }

    const ok = await revokeToken(user.id, tokenId);
    if (!ok) {
      return NextResponse.json({ error: "Failed to revoke token" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Revoke token error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
