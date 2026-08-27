import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpService } from "./mcp.service";

// ponytail: run MCP on its own Fastify instance to avoid Nest's global onSend
// hooks (helmet, x-request-id) aborting hijacked replies. Later tasks add auth/
// tenant middleware here. Can be fronted by the API gateway on a /mcp path later.
export function createMcpServer(svc: McpService): FastifyInstance {
  const app = Fastify();
  app.post("/mcp", async (req, res) => {
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
