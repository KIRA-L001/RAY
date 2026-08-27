import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getDb } from "@ray/database";
import { McpService } from "./mcp.service";
import { jwtSecret, verifyJwt, type JwtPayload } from "../../common/auth/jwt";

export type AuthedRequest = FastifyRequest & { rayAuth?: JwtPayload };

// ponytail: injectable for tests; prod hits Prisma. Returns true if the user may
// act as the given merchant (i.e. has a Membership row).
export type IsMerchantMember = (userId: string, merchantId: string) => Promise<boolean>;

export interface McpServerOptions {
  isMerchantMember?: IsMerchantMember;
}

// ponytail: stateless per-request auth reusing the app's HS256 JWT. Tenant
// scoping (which merchant a token maps to) is layered below.
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

async function defaultIsMember(userId: string, merchantId: string): Promise<boolean> {
  const m = await getDb().membership.findFirst({ where: { userId, merchantId } });
  return m !== null;
}

// ponytail: run MCP on its own Fastify instance to avoid Nest's global onSend
// hooks (helmet, x-request-id) aborting hijacked replies. Can be fronted by the
// API gateway on a /mcp path later.
export function createMcpServer(svc: McpService, opts: McpServerOptions = {}): FastifyInstance {
  const isMember = opts.isMerchantMember ?? defaultIsMember;
  const app = Fastify();
  app.post("/mcp", { preHandler: requireMcpAuth }, async (req, res) => {
    const auth = (req as AuthedRequest).rayAuth!;
    const merchantId = req.headers["x-ray-merchant-id"];
    if (typeof merchantId !== "string" || merchantId.length === 0) {
      res.code(400).send({ jsonrpc: "2.0", error: { code: -32602, message: "X-Ray-Merchant-Id header required" }, id: null });
      return;
    }
    // ponytail: admin users (adminRole set) still go through membership for now;
    // broaden to cross-merchant admin access if a use case appears.
    if (!(await isMember(auth.sub, merchantId))) {
      res.code(403).send({ jsonrpc: "2.0", error: { code: -32003, message: "forbidden: not a member of this merchant" }, id: null });
      return;
    }
    res.hijack();
    const server = svc.createServer(merchantId);
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
