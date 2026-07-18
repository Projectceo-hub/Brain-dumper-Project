import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

/**
 * Returns a Supabase client authenticated as the current browser session's
 * user. Reads the access/refresh cookies set by AuthGate on the client side
 * and uses them server-side via createServerClient from @supabase/ssr.
 * Authenticated against RLS — this client only sees the user's own rows.
 */
export async function createServerClientFromCookies() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Cookie store may be read-only in some contexts (Server Component).
            // Safe to ignore — reads still work.
          }
        },
      },
    }
  );
}

export async function getAuthenticatedUser() {
  const supabase = await createServerClientFromCookies();
  if (!supabase) return { supabase: null, user: null };

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return { supabase, user: null };
  return { supabase, user };
}
