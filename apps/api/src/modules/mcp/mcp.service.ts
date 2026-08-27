import { Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

@Injectable()
export class McpService {
  createServer(merchantId?: string): McpServer {
    const server = new McpServer({ name: "ray", version: "1.0.0" });
    // ponytail: only the health tool for now; catalog tools land in later tasks.
    // merchantId is threaded in from the authenticated request so every tool is
    // scoped to the calling merchant (tenant isolation).
    server.registerTool(
      "ping",
      { description: "Health check for the RAY MCP server", inputSchema: {} },
      async () => ({ content: [{ type: "text", text: merchantId ? `pong | merchant=${merchantId}` : "pong" }] }),
    );
    return server;
  }
}
