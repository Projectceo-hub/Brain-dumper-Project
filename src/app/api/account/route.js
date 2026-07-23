// DELETE /api/account
//
// Permanently deletes the current user's account and all of their data:
//   1. All notes owned by the user
//   2. All folders owned by the user
//   3. The auth user itself (via the Supabase Admin API)
//
// Auth: requires a valid Supabase session cookie. The session is used only
// to identify the caller — all destructive writes happen through the
// service-role client (which bypasses RLS) because:
//   - Notes/folders must be deleted across user_id even though the row
//     `user_id` equals the caller's id (RLS would technically permit this,
//     but the service role keeps it explicit and resilient).
//   - Deleting the auth user REQUIRES the service role's Admin API; there
//     is no client-side way for a user to delete their own auth row.
//
// On failure we return an error and do NOT sign out — the caller's data
// is still intact and they can retry. Only on full success do we return 200,
// at which point the client signs itself out and redirects to login.

import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { getServiceSupabase, isServiceRoleConfigured } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function DELETE() {
  try {
    const { user } = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isServiceRoleConfigured()) {
      console.error("Account deletion attempted but service role is not configured.");
      return NextResponse.json(
        { error: "Server is not configured for account deletion. Contact support." },
        { status: 500 },
      );
    }

    const supabase = getServiceSupabase();

    // 1. Delete notes first (folder deletion would orphan them otherwise).
    const { error: notesErr } = await supabase
      .from("notes")
      .delete()
      .eq("user_id", user.id);
    if (notesErr) {
      console.error("Failed to delete notes for user:", notesErr);
      return NextResponse.json(
        { error: "Failed to delete notes. Your account was not deleted." },
        { status: 500 },
      );
    }

    // 2. Delete folders.
    const { error: foldersErr } = await supabase
      .from("folders")
      .delete()
      .eq("user_id", user.id);
    if (foldersErr) {
      console.error("Failed to delete folders for user:", foldersErr);
      return NextResponse.json(
        { error: "Failed to delete folders. Your account was not deleted." },
        { status: 500 },
      );
    }

    // 3. Delete entities (best-effort cleanup — not strictly required but
    //    avoids orphaned entity rows).
    const { error: entitiesErr } = await supabase
      .from("entities")
      .delete()
      .eq("user_id", user.id);
    if (entitiesErr) {
      // Don't fail the whole deletion over entities — they're metadata-only.
      console.warn("Non-fatal: failed to delete entities for user:", entitiesErr);
    }

    // 4. Delete API tokens (so the user can't be re-authed via MCP clients).
    const { error: tokensErr } = await supabase
      .from("api_tokens")
      .delete()
      .eq("user_id", user.id);
    if (tokensErr) {
      console.warn("Non-fatal: failed to delete api_tokens for user:", tokensErr);
    }

    // 5. Finally, delete the auth user itself via the Admin API.
    const { error: userErr } = await supabase.auth.admin.deleteUser(user.id);
    if (userErr) {
      console.error("Failed to delete auth user:", userErr);
      return NextResponse.json(
        { error: "Failed to delete your auth account. Your data was deleted but login still exists — please contact support." },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Account deletion error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
