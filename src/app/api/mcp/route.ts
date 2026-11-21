import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { loadAccess } from "@/lib/access";
import { buildMcpServer } from "@/lib/mcp/server";
import { resourceMetadataUrl, SCOPE, verifyAccessToken } from "@/lib/oauth";
import { CORS, preflight } from "@/lib/oauth/http";

/**
 * Claude connector endpoint (MCP, Streamable HTTP, stateless).
 * Every request must carry a bearer token issued by /api/oauth/token.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized(error?: string) {
  const params = [`resource_metadata="${resourceMetadataUrl()}"`, `scope="${SCOPE}"`];
  if (error) params.unshift(`error="${error}"`);
  return new Response(JSON.stringify({ error: error ?? "unauthorized", error_description: "Sign in to AmzCentric OS to use this connector." }), {
    status: 401,
    headers: { ...CORS, "Content-Type": "application/json", "WWW-Authenticate": `Bearer ${params.join(", ")}` },
  });
}

async function handle(req: Request) {
  const header = req.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return unauthorized();
  const user = await verifyAccessToken(token);
  if (!user) return unauthorized("invalid_token");

  // Roles and brands are re-read on every request, so access changes apply immediately.
  const access = await loadAccess(user.userId, user.email);
  const server = buildMcpServer(user, access);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(req, {
    authInfo: { token, clientId: user.clientId, scopes: [SCOPE], expiresAt: user.expiresAt, extra: { email: user.email } },
  });
  const headers = new Headers(res.headers);
  Object.entries(CORS).forEach(([k, v]) => headers.set(k, v));
  return new Response(res.body, { status: res.status, headers });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = preflight;
