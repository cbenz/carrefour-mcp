import { access, chmod, mkdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { constants } from "node:fs";
import type { Browser, BrowserContext } from "playwright";
import { getDefaultContextOptions } from "../playwright.js";

export type AuthConfig = {
  enabled: boolean;
  statePath: string;
  browserProfileDir: string;
  browserChannel?: "chromium" | "chrome" | "msedge";
  loginTimeoutMs: number;
};

export type AuthStateMetadata = {
  exists: boolean;
  updatedAt?: string;
};

const DEFAULT_AUTH_LOGIN_TIMEOUT_MS = 180_000;
const DEFAULT_AUTH_STATE_PATH = path.join(
  homedir(),
  ".cache",
  "carrefour-mcp",
  "auth-state.json",
);
const DEFAULT_AUTH_BROWSER_PROFILE_DIR = path.join(
  homedir(),
  ".cache",
  "carrefour-mcp",
  "chromium-profile",
);

function parseBooleanFlag(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  if (["1", "true", "on", "yes"].includes(normalized)) {
    return true;
  }

  return defaultValue;
}

function parsePositiveInt(
  value: string | undefined,
  defaultValue: number,
): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return parsed;
}

function parseBrowserChannel(
  value: string | undefined,
): "chromium" | "chrome" | "msedge" | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "chromium") {
    return "chromium";
  }
  if (normalized === "chrome") {
    return "chrome";
  }
  if (normalized === "msedge") {
    return "msedge";
  }

  return undefined;
}

export function expandHomePath(rawPath: string): string {
  if (rawPath === "~") {
    return homedir();
  }

  if (rawPath.startsWith("~/")) {
    return path.join(homedir(), rawPath.slice(2));
  }

  return rawPath;
}

export function buildAuthConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  return {
    enabled: parseBooleanFlag(env.CARREFOUR_AUTH_ENABLED, true),
    statePath: expandHomePath(
      env.CARREFOUR_AUTH_STATE_PATH ?? DEFAULT_AUTH_STATE_PATH,
    ),
    browserProfileDir: expandHomePath(
      env.CARREFOUR_AUTH_BROWSER_PROFILE_DIR ??
        DEFAULT_AUTH_BROWSER_PROFILE_DIR,
    ),
    browserChannel: parseBrowserChannel(env.CARREFOUR_AUTH_BROWSER_CHANNEL),
    loginTimeoutMs: parsePositiveInt(
      env.CARREFOUR_AUTH_LOGIN_TIMEOUT_MS,
      DEFAULT_AUTH_LOGIN_TIMEOUT_MS,
    ),
  };
}

export async function authStateExists(statePath: string): Promise<boolean> {
  try {
    await access(statePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readAuthStateMetadata(
  statePath: string,
): Promise<AuthStateMetadata> {
  try {
    const stats = await stat(statePath);
    return {
      exists: true,
      updatedAt: stats.mtime.toISOString(),
    };
  } catch {
    return {
      exists: false,
    };
  }
}

async function ensureAuthStateDirectory(statePath: string): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
}

export async function persistAuthState(
  context: BrowserContext,
  statePath: string,
): Promise<void> {
  await ensureAuthStateDirectory(statePath);
  await context.storageState({ path: statePath });
  await chmod(statePath, 0o600).catch(() => undefined);
}

export async function deleteAuthState(statePath: string): Promise<void> {
  await rm(statePath, { force: true });
}

export async function createCarrefourContext(
  browser: Browser,
  options?: {
    useAuth?: boolean;
    requireAuth?: boolean;
    statePath?: string;
  },
): Promise<BrowserContext> {
  const config = buildAuthConfigFromEnv();
  const statePath = options?.statePath ?? config.statePath;
  const useAuth = options?.useAuth ?? config.enabled;
  const requireAuth = options?.requireAuth ?? false;

  const contextOptions = getDefaultContextOptions();

  if (useAuth) {
    const stateExists = await authStateExists(statePath);
    if (stateExists) {
      contextOptions.storageState = statePath;
    } else if (requireAuth) {
      throw new Error(
        `Authentication state not found at ${statePath}. Run auth_login first.`,
      );
    }
  }

  return browser.newContext(contextOptions);
}

export const __testing = {
  buildAuthConfigFromEnv,
  expandHomePath,
};
