export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(
    JSON.stringify({
      resource: "https://brain-dumper-project.vercel.app/api/mcp",
      authorization_servers: ["https://brain-dumper-project.vercel.app"],
      scopes_supported: ["mcp"],
      bearer_methods_supported: ["header"],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}
