import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../mcpServer.js";
import { logInfo } from "../logger.js";

export async function startStdioTransport(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logInfo("MCP stdio transport started");
}
