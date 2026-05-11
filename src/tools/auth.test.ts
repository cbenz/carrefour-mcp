import { homedir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import { __testing as authTesting } from "./auth.js";
import { __testing as sessionTesting } from "../auth/session.js";

test("buildAuthConfigFromEnv uses ~/.cache/carrefour-mcp by default", () => {
  const config = sessionTesting.buildAuthConfigFromEnv({});

  expect(config.statePath).toBe(
    path.join(homedir(), ".cache", "carrefour-mcp", "auth-state.json"),
  );
  expect(config.browserProfileDir).toBe(
    path.join(homedir(), ".cache", "carrefour-mcp", "chromium-profile"),
  );
  expect(config.enabled).toBe(true);
});

test("buildAuthConfigFromEnv expands home path override", () => {
  const config = sessionTesting.buildAuthConfigFromEnv({
    CARREFOUR_AUTH_STATE_PATH: "~/.cache/carrefour-mcp/custom-state.json",
    CARREFOUR_AUTH_BROWSER_PROFILE_DIR:
      "~/.cache/carrefour-mcp/custom-profile",
    CARREFOUR_AUTH_BROWSER_CHANNEL: "chrome",
    CARREFOUR_AUTH_ENABLED: "false",
    CARREFOUR_AUTH_LOGIN_TIMEOUT_MS: "45000",
  });

  expect(config.statePath).toBe(
    path.join(homedir(), ".cache", "carrefour-mcp", "custom-state.json"),
  );
  expect(config.browserProfileDir).toBe(
    path.join(homedir(), ".cache", "carrefour-mcp", "custom-profile"),
  );
  expect(config.browserChannel).toBe("chrome");
  expect(config.enabled).toBe(false);
  expect(config.loginTimeoutMs).toBe(45000);
});

test("isAuthenticatedSession detects authenticated signals", () => {
  expect(
    authTesting.isAuthenticatedSession({
      url: "https://www.carrefour.fr/mon-compte",
      bodyText: "Bonjour Jean, Mes commandes Se déconnecter",
    }),
  ).toBe(true);

  expect(
    authTesting.isAuthenticatedSession({
      url: "https://www.carrefour.fr/compte/connexion",
      bodyText: "Se connecter à votre compte",
    }),
  ).toBe(false);
});

test("auth testing exports default CDP URL", () => {
  expect(authTesting.DEFAULT_CDP_URL).toBe("http://127.0.0.1:9222");
});
