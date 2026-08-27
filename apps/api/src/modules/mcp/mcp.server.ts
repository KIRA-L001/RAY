import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpService } from "./mcp.service";
import { jwtSecret, verifyJwt, type JwtPayload } from "../../common/auth/jwt";

export type AuthedRequest = FastifyRequest & { rayAuth?: JwtPayload };

// ponytail: stateless per-request auth reusing the app's HS256 JWT. Tenant
// scoping (which merchant a token maps to) is layered in Task 82.
export function requireMcpAuth(req: FastifyRequest, res: FastifyReply, done: (err?: Error) => void): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  let payload: JwtPayload | null = null;
  try {
    payload = token ? verifyJwt(token, jwtSecret()) : null;
  } catch {
    payload = null;
  }
  if (!payload) {
    res.code(401).send({ jsonrpc: "2.0", error: { code: -32001, message: "unauthorized" }, id: null });
    return;
  }
  (req as AuthedRequest).rayAuth = payload;
  done();
}

// ponytail: run MCP on its own Fastify instance to avoid Nest's global onSend
// hooks (helmet, x-request-id) aborting hijacked replies. Can be fronted by the
// API gateway on a /mcp path later.
export function createMcpServer(svc: McpService): FastifyInstance {
  const app = Fastify();
  app.post("/mcp", { preHandler: requireMcpAuth }, async (req, res) => {
    res.hijack();
    const server = svc.createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    // ponytail: don't close the transport in the handler; it self-closes when the
    // SSE stream ends. Closing early cuts the response before the client reads it.
    transport.onclose = () => {
      void server.close();
    };
    await server.connect(transport);
    await transport.handleRequest(req.raw, res.raw, req.body);
  });
  return app;
}
