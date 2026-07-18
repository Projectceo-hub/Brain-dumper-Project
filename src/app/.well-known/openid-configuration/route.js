import { getDiscoveryMetadata } from "@/lib/oauth/discovery";

export async function GET(request) {
  const metadata = await getDiscoveryMetadata(request);
  return Response.json(metadata, {
    headers: { "Content-Type": "application/json" },
  });
}