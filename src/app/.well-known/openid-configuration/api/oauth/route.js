// /.well-known/openid-configuration/api/oauth
//
// Path-inserted OpenID discovery location for the authorization server whose
// issuer is <origin>/api/oauth. Same payload as the OAuth authorization-server
// document — some clients probe the openid-configuration name. Kept alongside
// the bare /.well-known/openid-configuration for clients that don't insert the
// issuer path.

import { getDiscoveryMetadata } from "@/lib/oauth/discovery";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const metadata = await getDiscoveryMetadata(request);
  return Response.json(metadata, {
    headers: { "Content-Type": "application/json" },
  });
}
