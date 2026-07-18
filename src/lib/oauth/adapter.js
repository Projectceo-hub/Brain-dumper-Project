// Custom oidc-provider adapter backed by Supabase.
// Persists oidc-provider models (Client, Session, AccessToken,
// AuthorizationCode, RefreshToken, etc.) across stateless Next.js
// API route boundaries, using the service-role Supabase client.
//
// Mirror of the SDK's MemoryAdapter signature — see
// node_modules/oidc-provider/lib/adapters/memory_adapter.js

import { getServiceSupabase } from "@/lib/supabase/service";

const GRANTABLE = new Set([
  "AccessToken",
  "AuthorizationCode",
  "RefreshToken",
  "DeviceCode",
  "BackchannelAuthenticationRequest",
]);

export class SupabaseOidcAdapter {
  constructor(model) {
    this.model = model;
  }

  key(id) {
    return `${this.model}:${id}`;
  }

  async destroy(id) {
    const supabase = getServiceSupabase();
    if (!supabase) return;
    await supabase.from("oidc_models").delete().eq("id", this.key(id));
  }

  async consume(id) {
    const supabase = getServiceSupabase();
    if (!supabase) return;
    await supabase
      .from("oidc_models")
      .update({ consumed: new Date().toISOString() })
      .eq("id", this.key(id));
  }

  async find(id) {
    const supabase = getServiceSupabase();
    if (!supabase) return undefined;
    const { data } = await supabase
      .from("oidc_models")
      .select("payload")
      .eq("id", this.key(id))
      .maybeSingle();
    return data?.payload ?? undefined;
  }

  async findByUid(uid) {
    const supabase = getServiceSupabase();
    if (!supabase) return undefined;
    // uid is a string that maps to a Session record already keyed as
    // "Session:<id>". The UID index is maintained by the Session adapter's
    // upsert which stores the uid -> session_id mapping as a separate
    // row with model "SessionUid". This mirrors the memory adapter's
    // sessionUidKeyFor pattern.
    const { data: mapping } = await supabase
      .from("oidc_models")
      .select("payload")
      .eq("id", `SessionUid:${uid}`)
      .maybeSingle();
    if (!mapping?.payload?.sessionId) return undefined;
    return this.find(mapping.payload.sessionId);
  }

  async findByUserCode(userCode) {
    const supabase = getServiceSupabase();
    if (!supabase) return undefined;
    // Same indirection: a "UserCode:<code>" row stores the actual model id.
    const { data: mapping } = await supabase
      .from("oidc_models")
      .select("payload")
      .eq("id", `UserCode:${userCode}`)
      .maybeSingle();
    if (!mapping?.payload?.id) return undefined;
    return this.find(mapping.payload.id);
  }

  async upsert(id, payload, expiresIn) {
    const supabase = getServiceSupabase();
    if (!supabase) return;

    const key = this.key(id);
    const expireMs = Date.now() + expiresIn * 1000;
    const expiresAt = new Date(expireMs).toISOString();

    // Session → store uid-to-id mapping
    if (this.model === "Session" && payload.uid) {
      await supabase.from("oidc_models").upsert(
        {
          id: `SessionUid:${payload.uid}`,
          model_type: "SessionUid",
          payload: { sessionId: id, uid: payload.uid },
          expires_at: expiresAt,
        },
        { onConflict: "id" },
      );
    }

    // Grantable models → maintain grant -> [token keys] list
    const { grantId, userCode } = payload || {};
    if (GRANTABLE.has(this.model) && grantId) {
      const grantKey = `Grant:${grantId}`;
      const { data: existing } = await supabase
        .from("oidc_models")
        .select("payload")
        .eq("id", grantKey)
        .maybeSingle();

      const keys = Array.isArray(existing?.payload?.keys)
        ? [...new Set([...existing.payload.keys, key])]
        : [key];

      await supabase.from("oidc_models").upsert(
        {
          id: grantKey,
          model_type: "Grant",
          payload: { keys },
          expires_at: expiresAt,
        },
        { onConflict: "id" },
      );
    }

    if (userCode) {
      await supabase.from("oidc_models").upsert(
        {
          id: `UserCode:${userCode}`,
          model_type: "UserCode",
          payload: { id },
          expires_at: expiresAt,
        },
        { onConflict: "id" },
      );
    }

    await supabase.from("oidc_models").upsert(
      {
        id: key,
        model_type: this.model,
        payload,
        expires_at: expiresAt,
      },
      { onConflict: "id" },
    );
  }

  async revokeByGrantId(grantId) {
    const supabase = getServiceSupabase();
    if (!supabase) return;

    const grantKey = `Grant:${grantId}`;
    const { data } = await supabase
      .from("oidc_models")
      .select("payload")
      .eq("id", grantKey)
      .maybeSingle();

    const keys = Array.isArray(data?.payload?.keys) ? data.payload.keys : [];

    // Delete every token key in the grant list
    for (const tokenKey of keys) {
      await supabase.from("oidc_models").delete().eq("id", tokenKey);
    }

    // Delete the grant list itself
    await supabase.from("oidc_models").delete().eq("id", grantKey);
  }
}