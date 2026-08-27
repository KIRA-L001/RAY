import { Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

@Injectable()
export class McpService {
  createServer(): McpServer {
    const server = new McpServer({ name: "ray", version: "1.0.0" });
    // ponytail: only the health tool for now; catalog tools land in later tasks
    server.registerTool(
      "ping",
      { description: "Health check for the RAY MCP server", inputSchema: {} },
      async () => ({ content: [{ type: "text", text: "pong" }] }),
    );
    return server;
  }
}
