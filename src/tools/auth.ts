import { chromium, type Page } from "playwright";
import {
  buildAuthConfigFromEnv,
  createCarrefourContext,
  deleteAuthState,
  persistAuthState,
  readAuthStateMetadata,
} from "../auth/session.js";
import { getSharedBrowser } from "../playwright.js";

const ACCOUNT_URL = "https://www.carrefour.fr/mon-compte";
const DEFAULT_CDP_URL = "http://127.0.0.1:9222";

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

async function waitForAuthenticatedSession(
  page: Page,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const signals = await readSignals(page);
    if (isAuthenticatedSession(signals)) {
      return true;
    }

    await page.waitForTimeout(1000);
  }

  return false;
}

export async function loginCarrefourAuth(
  timeoutMs?: number,
): Promise<AuthLoginResult> {
  const config = buildAuthConfigFromEnv();
  const loginTimeoutMs = timeoutMs ?? config.loginTimeoutMs;

  if (!config.enabled) {
    return {
      authenticated: false,
      statePath: config.statePath,
      message:
        "Authentication is disabled by CARREFOUR_AUTH_ENABLED. Enable it to login.",
    };
  }

  const context = await chromium.launchPersistentContext(
    config.browserProfileDir,
    {
      headless: false,
      channel: config.browserChannel,
      locale: "fr-FR",
      viewport: {
        width: 1440,
        height: 1200,
      },
    },
  );

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(ACCOUNT_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    const authenticated = await waitForAuthenticatedSession(
      page,
      loginTimeoutMs,
    );

    if (!authenticated) {
      return {
        authenticated: false,
        statePath: config.statePath,
        message:
          "Login timeout reached. If Cloudflare challenge is shown, complete it manually in the opened browser and retry with a longer timeout, or use auth_capture_cdp with a manually authenticated Chrome session.",
      };
    }

    await persistAuthState(context, config.statePath);
    return {
      authenticated: true,
      statePath: config.statePath,
      message: "Authentication state saved successfully.",
    };
  } finally {
    await context.close();
  }
}

export async function captureCarrefourAuthFromCdp(
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

  const browser = await getSharedBrowser();
  const context = await createCarrefourContext(browser, {
    useAuth: true,
    requireAuth: true,
    statePath: config.statePath,
  });

  try {
    const page = await context.newPage();
    await page.goto(ACCOUNT_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page
      .waitForLoadState("networkidle", { timeout: 7000 })
      .catch(() => undefined);

    const authenticated = isAuthenticatedSession(await readSignals(page));

    return {
      authenticated,
      statePath: config.statePath,
      updatedAt: metadata.updatedAt,
      reason: authenticated
        ? undefined
        : "Stored session seems expired or unauthenticated.",
    };
  } finally {
    await context.close();
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
};
