// Custom oidc-provider adapter backed by Supabase.
// Persists oidc-provider models (Client, Session, AccessToken,
// AuthorizationCode, RefreshToken, etc.) across stateless Next.js
// API route boundaries, using the service-role Supabase client.
//
// Mirror of the SDK's MemoryAdapter signature — see
// node_modules/oidc-provider/lib/adapters/memory_adapter.js

import { getServiceSupabase } from "@/lib/supabase/service";

// The Client model lives in its own table with a NULL expiry so DCR-registered
// clients (e.g. Claude.ai's connector) survive serverless cold starts. In
// oidc_models every row carries a non-null expires_at (default now()+24h), so a
// client stored there is swept — the "registers once, gone next request" bug.
const CLIENT_MODEL = "Client";
const CLIENTS_TABLE = "oidc_clients";

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
    if (this.model === CLIENT_MODEL) {
      await supabase.from(CLIENTS_TABLE).delete().eq("id", id);
      return;
    }
    await supabase.from("oidc_models").delete().eq("id", this.key(id));
  }

  async consume(id) {
    const supabase = getServiceSupabase();
    if (!supabase) return;
    if (this.model === CLIENT_MODEL) {
      await supabase
        .from(CLIENTS_TABLE)
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", id);
      return;
    }
    await supabase
      .from("oidc_models")
      .update({ consumed: new Date().toISOString() })
      .eq("id", this.key(id));
  }

  async find(id) {
    const supabase = getServiceSupabase();
    if (!supabase) return undefined;
    if (this.model === CLIENT_MODEL) {
      const { data } = await supabase
        .from(CLIENTS_TABLE)
        .select("payload")
        .eq("id", id)
        .maybeSingle();
      return data?.payload ?? undefined;
    }
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

    // Client → dedicated table, expires_at NULL (never expires). oidc-provider
    // calls upsert for a Client with no expiresIn, so the expiresAt math below
    // would produce an invalid date; short-circuit before it runs.
    if (this.model === CLIENT_MODEL) {
      await supabase.from(CLIENTS_TABLE).upsert(
        { id, payload, expires_at: null },
        { onConflict: "id" },
      );
      return;
    }

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
    //
    // KEY NAMESPACE: this index MUST NOT use `Grant:<id>`. "Grant" is a real
    // oidc-provider model (provider.Grant, created during consent), so it
    // stores its own payload under this.key(id) === `Grant:<id>`. Sharing the
    // namespace meant the index below overwrote the actual grant — and the
    // grant overwrote the index — silently breaking consent. The SDK's memory
    // adapter avoids this the same way, with a separate grantKeyFor prefix.
    const { grantId, userCode } = payload || {};
    if (GRANTABLE.has(this.model) && grantId) {
      const grantKey = `GrantIndex:${grantId}`;
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
          model_type: "GrantIndex",
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

    // Must match the index namespace written in upsert().
    const grantKey = `GrantIndex:${grantId}`;
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