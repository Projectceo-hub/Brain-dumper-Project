// /.well-known/openid-configuration
//
// Some clients probe the OIDC discovery location before the OAuth one. This
// server is not an OpenID Provider — it issues no ID tokens — but serving the
// identical OAuth metadata here is harmless and saves those clients a 404.
// Kept byte-for-byte identical to /.well-known/oauth-authorization-server;
// two discovery documents that disagree is a bug this project has already paid
// for once.

import { getDiscoveryMetadata } from "@/lib/oauth/discovery";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const metadata = await getDiscoveryMetadata(request);
  return Response.json(metadata, {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
