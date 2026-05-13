import { InvalidArgumentError } from "commander";

function normalizeHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1).toLowerCase()
    : hostname.toLowerCase();
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);

  return (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "::1"
  );
}

export function parseRemoteServerUrl(value: string): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw new InvalidArgumentError("--server-url must be a valid HTTP or HTTPS URL");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new InvalidArgumentError("--server-url must use http or https");
  }

  if (isLoopbackHostname(parsedUrl.hostname)) {
    throw new InvalidArgumentError(
      "--server-url must target a non-local MCP server; localhost, 127.0.0.1 and ::1 are refused",
    );
  }

  return parsedUrl.toString();
}