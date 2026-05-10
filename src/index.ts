import { logError } from "./logger.js";
import { startHttpTransport } from "./transports/http.js";
import { startStdioTransport } from "./transports/stdio.js";

type TransportMode = "stdio" | "http" | "both";

function getMode(): TransportMode {
  const raw = (process.env.MCP_TRANSPORT ?? "both").trim().toLowerCase();
  if (raw === "stdio" || raw === "http" || raw === "both") {
    return raw;
  }
  return "both";
}

function getHttpPort(): number {
  const rawPort = process.env.PORT ?? "3000";
  const parsed = Number.parseInt(rawPort, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 3000;
  }
  return parsed;
}

async function main(): Promise<void> {
  const mode = getMode();

  if (mode === "stdio" || mode === "both") {
    await startStdioTransport();
  }

  if (mode === "http" || mode === "both") {
    await startHttpTransport(getHttpPort());
  }
}

main().catch((error) => {
  logError("Server startup failed", error);
  process.exit(1);
});
