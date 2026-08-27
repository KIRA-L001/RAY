import { config } from "dotenv";
import { McpService } from "./modules/mcp/mcp.service";
import { createMcpServer } from "./modules/mcp/mcp.server";

config({ path: "../../.env" });
config();

// Standalone MCP server process. Run separately from the API (pnpm --filter @ray/api mcp)
// because the SDK's Hono-based transport relies on native globalThis.Response/Request,
// which the API's module graph pollutes; a clean process avoids that.
// ponytail: sidecar process is the laziest reliable option; front it with the gateway later.
const port = Number(process.env.MCP_PORT ?? 4001);
const server = createMcpServer(new McpService());
server.listen({ port, host: "0.0.0.0" }).then(() => console.log(`ray-mcp listening on ${port}`));
