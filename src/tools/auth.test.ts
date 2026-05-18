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
		CARREFOUR_AUTH_BROWSER_PROFILE_DIR: "~/.cache/carrefour-mcp/custom-profile",
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

test("buildManualChromeLaunchPlan builds launch command with defaults", () => {
	const plan = authTesting.buildManualChromeLaunchPlan({});

	expect(plan.chromeBinary).toBe("chromium");
	expect(plan.cdpUrl).toBe("http://127.0.0.1:9222");
	expect(plan.profileDir).toBe(
		path.join(homedir(), ".cache", "carrefour-mcp", "manual-chrome"),
	);
	expect(plan.args).toContain("--remote-debugging-port=9222");
	expect(plan.args).toContain(
		`--user-data-dir=${path.join(homedir(), ".cache", "carrefour-mcp", "manual-chrome")}`,
	);
});

test("buildManualChromeRemoteCommandPlan builds ssh command with defaults", () => {
	const plan = authTesting.buildManualChromeRemoteCommandPlan({});

	expect(plan.sshTarget).toBe("coursicota@203.0.113.42");
	expect(plan.command).toContain("ssh -Y coursicota@203.0.113.42 chromium");
	expect(plan.command).toContain("--remote-debugging-port=9222");
	expect(plan.command).toContain(
		"--user-data-dir=/home/coursicota/.cache/carrefour-mcp/manual-chrome",
	);
});

test("buildManualChromeLaunchPlan respects custom cdp url and profile", () => {
	const plan = authTesting.buildManualChromeLaunchPlan({
		cdpUrl: "http://127.0.0.1:9333",
		profileDir: "~/.cache/carrefour-mcp/custom-manual",
		chromeBinary: "chromium",
	});

	expect(plan.chromeBinary).toBe("chromium");
	expect(plan.cdpUrl).toBe("http://127.0.0.1:9333");
	expect(plan.profileDir).toBe(
		path.join(homedir(), ".cache", "carrefour-mcp", "custom-manual"),
	);
	expect(plan.args).toContain("--remote-debugging-port=9333");
	expect(plan.command).toContain("chromium");
});

test("isValidStorageStatePayload validates minimal Playwright shape", () => {
	expect(
		authTesting.isValidStorageStatePayload({
			cookies: [
				{
					name: "cf_clearance",
					value: "token",
					domain: ".carrefour.fr",
					path: "/",
				},
			],
			origins: [],
		}),
	).toBe(true);

	expect(
		authTesting.isValidStorageStatePayload({
			cookies: [{ name: "missing-fields" }],
			origins: [],
		}),
	).toBe(false);
});
