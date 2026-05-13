import { describe, expect, test } from "vitest";

import {
  isLoopbackHostname,
  parseRemoteServerUrl,
} from "./remoteServerUrl.js";

describe("isLoopbackHostname", () => {
  test("detects common loopback hostnames", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("api.localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });

  test("does not flag remote hostnames", () => {
    expect(isLoopbackHostname("carrefour-mcp.coursicota.com")).toBe(false);
    expect(isLoopbackHostname("192.168.1.20")).toBe(false);
  });
});

describe("parseRemoteServerUrl", () => {
  test("accepts a remote https server url", () => {
    expect(parseRemoteServerUrl("https://carrefour-mcp.coursicota.com/mcp")).toBe(
      "https://carrefour-mcp.coursicota.com/mcp",
    );
  });

  test("rejects loopback destinations", () => {
    expect(() => parseRemoteServerUrl("http://127.0.0.1:3000/mcp")).toThrow(
      /non-local MCP server/,
    );
    expect(() => parseRemoteServerUrl("http://localhost:3000/mcp")).toThrow(
      /non-local MCP server/,
    );
    expect(() => parseRemoteServerUrl("http://\[::1\]:3000/mcp")).toThrow(
      /non-local MCP server/,
    );
  });
});