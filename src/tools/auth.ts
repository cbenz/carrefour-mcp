import { chromium, type Page } from "playwright";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import {
  buildAuthConfigFromEnv,
  createCarrefourContext,
  deleteAuthState,
  expandHomePath,
  persistAuthState,
  readAuthStateMetadata,
} from "../auth/session.js";
import { getSharedBrowser } from "../playwright.js";

const ACCOUNT_URL = "https://www.carrefour.fr/mon-compte";
const DEFAULT_CDP_URL = "http://127.0.0.1:9222";
const DEFAULT_MANUAL_PROFILE_DIR = "~/.cache/carrefour-mcp/manual-chrome";
const DEFAULT_CHROME_BIN = "google-chrome";

type AuthDetectionSignals = {
  url: string;
  bodyText: string;
};

export type AuthLoginResult = {
  authenticated: boolean;
  statePath: string;
  message: string;
};

export type AuthStatusResult = {
  authenticated: boolean;
  statePath: string;
  updatedAt?: string;
  reason?: string;
};

export type AuthImportResult = {
  imported: boolean;
  statePath: string;
  updatedAt: string;
  message: string;
};

export type ManualChromeLaunchPlan = {
  cdpUrl: string;
  chromeBinary: string;
  profileDir: string;
  args: string[];
  command: string;
};

function isAuthenticatedSession(signals: AuthDetectionSignals): boolean {
  const normalizedUrl = signals.url.toLowerCase();
  const normalizedBody = signals.bodyText.toLowerCase();

  const hasPositiveSignal =
    normalizedBody.includes("se déconnecter") ||
    normalizedBody.includes("mes commandes") ||
    normalizedBody.includes("mon compte") ||
    normalizedUrl.includes("/mon-compte");

  const hasNegativeSignal =
    normalizedBody.includes("se connecter") ||
    normalizedBody.includes("identifiez-vous") ||
    normalizedUrl.includes("connexion");

  return hasPositiveSignal && !hasNegativeSignal;
}

async function readSignals(page: Page): Promise<AuthDetectionSignals> {
  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "");

  return {
    url: page.url(),
    bodyText,
  };
}

function quoteShellArg(value: string): string {
  if (value.length === 0) {
    return "''";
  }

  if (/^[a-zA-Z0-9_./:@=-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function getDefaultCdpUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.CARREFOUR_AUTH_CDP_URL?.trim() || DEFAULT_CDP_URL;
}

function getManualChromeProfileDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return expandHomePath(
    env.CARREFOUR_AUTH_MANUAL_PROFILE_DIR ?? DEFAULT_MANUAL_PROFILE_DIR,
  );
}

function getManualChromeBinary(env: NodeJS.ProcessEnv = process.env): string {
  return env.CARREFOUR_AUTH_CHROME_BIN?.trim() || DEFAULT_CHROME_BIN;
}

function deriveDebugPort(cdpUrl: string): number {
  const parsed = new URL(cdpUrl);
  const rawPort = parsed.port || "9222";
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid CDP URL port: ${cdpUrl}`);
  }
  return port;
}

export function buildManualChromeLaunchPlan(
  options?: {
    cdpUrl?: string;
    profileDir?: string;
    chromeBinary?: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): ManualChromeLaunchPlan {
  const cdpUrl = options?.cdpUrl?.trim() || getDefaultCdpUrl(env);
  const port = deriveDebugPort(cdpUrl);
  const profileDir = expandHomePath(
    options?.profileDir?.trim() || getManualChromeProfileDir(env),
  );
  const chromeBinary =
    options?.chromeBinary?.trim() || getManualChromeBinary(env);

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    ACCOUNT_URL,
  ];

  return {
    cdpUrl,
    chromeBinary,
    profileDir,
    args,
    command: [chromeBinary, ...args].map(quoteShellArg).join(" "),
  };
}

export async function cleanupManualChromeProfileDir(
  profileDir?: string,
  cdpUrl?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ profileDir: string; cleaned: boolean; message?: string }> {
  const resolvedProfileDir = expandHomePath(
    profileDir?.trim() || getManualChromeProfileDir(env),
  );

  // First, try to close Chrome via CDP gracefully
  if (cdpUrl) {
    try {
      const browser = await chromium.connectOverCDP(cdpUrl);
      await browser.close();
    } catch {
      // CDP connection failed or Chrome already closed, will proceed with force kill
    }
  }

  // Wait a bit for Chrome to finish shutting down
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Force kill any remaining Chrome processes using this profile directory
  // Use lsof to find processes with this directory open, extract their PIDs, and kill them
  try {
    const result = execSync(
      `lsof +D '${resolvedProfileDir}' 2>/dev/null | awk 'NR>1 {print $2}' | sort -u | xargs -r kill -9`,
      { encoding: "utf-8", stdio: "pipe" },
    );
    // Result may be empty if no processes found, which is fine
  } catch (error) {
    // lsof or kill may fail, but we'll proceed to delete the directory anyway
  }

  // Wait again to ensure processes are terminated
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Delete the profile directory
  await rm(resolvedProfileDir, { recursive: true, force: true });

  return {
    profileDir: resolvedProfileDir,
    cleaned: true,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidStorageStatePayload(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }

  const cookies = value.cookies;
  const origins = value.origins;
  if (!Array.isArray(cookies) || !Array.isArray(origins)) {
    return false;
  }

  return cookies.every((cookie) => {
    if (!isPlainObject(cookie)) {
      return false;
    }

    return (
      typeof cookie.name === "string" &&
      typeof cookie.value === "string" &&
      typeof cookie.domain === "string" &&
      typeof cookie.path === "string"
    );
  });
}

export async function importCarrefourAuthState(
  storageState: unknown,
  destinationPath?: string,
): Promise<AuthImportResult> {
  const config = buildAuthConfigFromEnv();

  if (!config.enabled) {
    throw new Error(
      "Authentication is disabled by CARREFOUR_AUTH_ENABLED. Enable it to import auth state.",
    );
  }

  if (!isValidStorageStatePayload(storageState)) {
    throw new Error(
      "Invalid storageState payload. Expected a Playwright storageState object with cookies and origins arrays.",
    );
  }

  const targetPath = destinationPath
    ? expandHomePath(destinationPath)
    : config.statePath;

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify(storageState, null, 2), {
    encoding: "utf-8",
  });
  await chmod(targetPath, 0o600).catch(() => undefined);
  const stateStats = await stat(targetPath);

  return {
    imported: true,
    statePath: targetPath,
    updatedAt: stateStats.mtime.toISOString(),
    message: "Authentication state imported successfully.",
  };
}

export async function loginCarrefourAuth(
  _timeoutMs?: number,
): Promise<AuthLoginResult> {
  const config = buildAuthConfigFromEnv();

  if (!config.enabled) {
    return {
      authenticated: false,
      statePath: config.statePath,
      message:
        "Authentication is disabled by CARREFOUR_AUTH_ENABLED. Enable it to login.",
    };
  }

  try {
    const result = await captureCarrefourAuthState(DEFAULT_CDP_URL);
    if (result.authenticated) {
      return {
        ...result,
        message:
          "Authentication state captured from existing browser session (auth_login now uses CDP at the default endpoint).",
      };
    }

    return {
      ...result,
      message:
        "auth_login uses CDP capture by default. Start Chrome with --remote-debugging-port=9222 and an explicit --user-data-dir, authenticate on Carrefour, then retry auth_login or auth_capture_state --cdp-url <url>.",
    };
  } catch (error) {
    const details = error instanceof Error ? ` (${error.message})` : "";
    return {
      authenticated: false,
      statePath: config.statePath,
      message:
        "auth_login uses CDP capture by default and could not connect to http://127.0.0.1:9222. Start Chrome with --remote-debugging-port=9222 and an explicit --user-data-dir, authenticate on Carrefour, then retry." +
        details,
    };
  }
}

export async function captureCarrefourAuthState(
  cdpUrl = DEFAULT_CDP_URL,
): Promise<AuthLoginResult> {
  const config = buildAuthConfigFromEnv();

  if (!config.enabled) {
    return {
      authenticated: false,
      statePath: config.statePath,
      message:
        "Authentication is disabled by CARREFOUR_AUTH_ENABLED. Enable it to capture auth state.",
    };
  }

  const browser = await chromium.connectOverCDP(cdpUrl);

  try {
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error(
        "No browser context found on CDP target. Open a normal browsing window first.",
      );
    }

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(ACCOUNT_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page
      .waitForLoadState("networkidle", { timeout: 7000 })
      .catch(() => undefined);

    const authenticated = isAuthenticatedSession(await readSignals(page));
    if (!authenticated) {
      return {
        authenticated: false,
        statePath: config.statePath,
        message:
          "Attached browser session does not look authenticated on Carrefour account pages yet.",
      };
    }

    await persistAuthState(context, config.statePath);
    return {
      authenticated: true,
      statePath: config.statePath,
      message: "Authentication state captured from existing browser session.",
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function getCarrefourAuthStatus(): Promise<AuthStatusResult> {
  const config = buildAuthConfigFromEnv();
  const metadata = await readAuthStateMetadata(config.statePath);

  if (!metadata.exists) {
    return {
      authenticated: false,
      statePath: config.statePath,
      reason: "No authentication state file found.",
    };
  }

  // Verify the stored state is valid JSON with proper storageState structure
  try {
    const content = await readFile(config.statePath, "utf-8");
    const state = JSON.parse(content);

    // Check minimal storageState structure
    const hasValidStructure =
      typeof state === "object" &&
      Array.isArray(state.cookies) &&
      Array.isArray(state.origins);

    if (!hasValidStructure) {
      return {
        authenticated: false,
        statePath: config.statePath,
        reason: "Stored state has invalid structure.",
      };
    }

    // Check if there are any cookies (minimal validation)
    const hasValidCookies = state.cookies.length > 0;

    return {
      authenticated: hasValidCookies,
      statePath: config.statePath,
      updatedAt: metadata.updatedAt,
      reason: hasValidCookies ? undefined : "Stored session has no cookies.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      authenticated: false,
      statePath: config.statePath,
      reason: `Failed to read stored state: ${message}`,
    };
  }
}

export async function logoutCarrefourAuth(): Promise<{
  loggedOut: boolean;
  statePath: string;
}> {
  const config = buildAuthConfigFromEnv();
  await deleteAuthState(config.statePath);
  return {
    loggedOut: true,
    statePath: config.statePath,
  };
}

export const __testing = {
  isAuthenticatedSession,
  DEFAULT_CDP_URL,
  buildManualChromeLaunchPlan,
  cleanupManualChromeProfileDir,
  isValidStorageStatePayload,
};
