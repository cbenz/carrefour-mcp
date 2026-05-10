import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../mcpServer.js";
import { logError, logInfo } from "../logger.js";

function writeJsonRpcError(res: Response, code: number, message: string): void {
  if (res.headersSent) {
    return;
  }
  res.status(500).json({
    jsonrpc: "2.0",
    error: {
      code,
      message,
    },
    id: null,
  });
}

async function handlePost(req: Request, res: Response): Promise<void> {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logError("Error while handling MCP HTTP request", error);
    writeJsonRpcError(res, -32603, "Internal server error");
  } finally {
    transport.close();
    server.close();
  }
}

function handleMethodNotAllowed(res: Response): void {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
}

export async function startHttpTransport(port: number): Promise<void> {
  const app = createMcpExpressApp({ host: "127.0.0.1" });

  app.post("/mcp", (req, res) => {
    void handlePost(req, res);
  });

  app.get("/mcp", (_req, res) => {
    handleMethodNotAllowed(res);
  });

  app.delete("/mcp", (_req, res) => {
    handleMethodNotAllowed(res);
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "carrefour-mcp",
    });
  });

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => {
      logInfo(`MCP HTTP server started at http://127.0.0.1:${port}/mcp`);
      resolve();
    });
    server.on("error", reject);
  });
}
