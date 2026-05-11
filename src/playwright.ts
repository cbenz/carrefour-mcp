import { chromium, type Browser, type BrowserContextOptions } from "playwright";

let sharedBrowserPromise: Promise<Browser> | undefined;

export function getDefaultContextOptions(): BrowserContextOptions {
  return {
    locale: "fr-FR",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    viewport: {
      width: 1440,
      height: 1200,
    },
  };
}

export async function getSharedBrowser(): Promise<Browser> {
  if (!sharedBrowserPromise) {
    sharedBrowserPromise = chromium
      .launch({ headless: true })
      .catch((error) => {
        sharedBrowserPromise = undefined;
        throw error;
      });
  }

  return sharedBrowserPromise;
}

export async function closeSharedBrowser(): Promise<void> {
  if (!sharedBrowserPromise) {
    return;
  }

  const browser = await sharedBrowserPromise.catch(() => undefined);
  sharedBrowserPromise = undefined;

  if (browser) {
    await browser.close();
  }
}
