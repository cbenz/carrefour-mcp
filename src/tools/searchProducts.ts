import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { createCarrefourContext } from "../auth/session.js";
import { closeSharedBrowser, getSharedBrowser } from "../playwright.js";

export type Product = {
  name: string;
  url: string;
  id?: string;
  price?: number;
  currency?: string;
  image?: string;
};

export type SearchProductsResult = {
  query: string;
  count: number;
  products: Product[];
};

type LoadedSearchPage = {
  html: string;
  products: Product[];
};

type SearchCacheEntry = {
  createdAt: number;
  pageData: LoadedSearchPage;
};

type SearchCacheConfig = {
  enabled: boolean;
  cacheDir: string;
  ttlMs: number;
  now: () => number;
};

const SEARCH_BASE_URL = "https://www.carrefour.fr/s";
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_CACHE_DIR = path.join(process.cwd(), ".cache", "carrefour-mcp");

export async function closeBrowser(): Promise<void> {
  await closeSharedBrowser();
}

function parsePriceText(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.replace(/\s+/g, "").match(/(\d+(?:,\d+)?)€/);
  if (!match) {
    return undefined;
  }

  const price = Number.parseFloat(match[1].replace(",", "."));
  return Number.isFinite(price) ? price : undefined;
}

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

function buildSearchCacheConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SearchCacheConfig {
  const ttlMsRaw = env.CARREFOUR_SEARCH_CACHE_TTL_MS;
  const parsedTtlMs = ttlMsRaw ? Number.parseInt(ttlMsRaw, 10) : Number.NaN;

  return {
    enabled: parseBooleanFlag(env.CARREFOUR_SEARCH_CACHE_ENABLED, true),
    cacheDir: env.CARREFOUR_SEARCH_CACHE_DIR ?? DEFAULT_CACHE_DIR,
    ttlMs:
      Number.isFinite(parsedTtlMs) && parsedTtlMs >= 0
        ? parsedTtlMs
        : DEFAULT_CACHE_TTL_MS,
    now: () => Date.now(),
  };
}

function getCacheFilePath(cacheDir: string, key: string): string {
  return path.join(cacheDir, `${key}.json`);
}

function buildCacheKey(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

async function readCacheEntry(
  url: string,
  config: SearchCacheConfig,
): Promise<LoadedSearchPage | undefined> {
  const cacheFilePath = getCacheFilePath(config.cacheDir, buildCacheKey(url));

  try {
    const entryRaw = await readFile(cacheFilePath, "utf-8");
    const entry = JSON.parse(entryRaw) as SearchCacheEntry;
    if (
      !entry ||
      typeof entry.createdAt !== "number" ||
      !entry.pageData ||
      typeof entry.pageData !== "object"
    ) {
      return undefined;
    }

    const expiresAt = entry.createdAt + config.ttlMs;
    if (expiresAt < config.now()) {
      await rm(cacheFilePath, { force: true }).catch(() => undefined);
      return undefined;
    }

    return entry.pageData;
  } catch {
    return undefined;
  }
}

async function writeCacheEntry(
  url: string,
  pageData: LoadedSearchPage,
  config: SearchCacheConfig,
): Promise<void> {
  const cacheKey = buildCacheKey(url);
  const cacheFilePath = getCacheFilePath(config.cacheDir, cacheKey);
  const tempFilePath = getCacheFilePath(
    config.cacheDir,
    `${cacheKey}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`,
  );

  const entry: SearchCacheEntry = {
    createdAt: config.now(),
    pageData,
  };

  await mkdir(config.cacheDir, { recursive: true });
  await writeFile(tempFilePath, JSON.stringify(entry), "utf-8");
  await rename(tempFilePath, cacheFilePath);
}

async function loadSearchPageDataWithCache(
  url: string,
  loader: (targetUrl: string) => Promise<LoadedSearchPage> = loadSearchPageData,
  config: SearchCacheConfig = buildSearchCacheConfigFromEnv(),
): Promise<LoadedSearchPage> {
  if (config.enabled) {
    const cached = await readCacheEntry(url, config);
    if (cached) {
      return cached;
    }
  }

  const loaded = await loader(url);

  if (config.enabled) {
    await writeCacheEntry(url, loaded, config).catch(() => undefined);
  }

  return loaded;
}

async function loadSearchPageData(url: string): Promise<LoadedSearchPage> {
  const browser = await getSharedBrowser();
  const context = await createCarrefourContext(browser, {
    useAuth: true,
  });

  try {
    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    if (!response) {
      throw new Error("Carrefour search page did not return a response");
    }

    if (response.status() >= 400) {
      throw new Error(
        `Carrefour search request failed with status ${response.status()}`,
      );
    }

    await page
      .waitForLoadState("networkidle", { timeout: 10000 })
      .catch(() => undefined);
    const html = await page.content();
    const products = extractProductsFromRenderedHtml(html);

    return {
      html,
      products,
    };
  } finally {
    await context.close();
  }
}

function extractProductsFromRenderedHtml(html: string): Product[] {
  const $ = cheerio.load(html);
  const products: Product[] = [];

  $("main article").each((_, article) => {
    const card = $(article);
    const productLink = card.find('a[href^="/p/"]').first();
    const title = card.find("h3").first().text().trim() || undefined;
    const textCandidates = card
      .find("p, span, div")
      .toArray()
      .map((element) => $(element).text().replace(/\s+/g, " ").trim())
      .filter((text) => text.length > 0);
    const priceText =
      textCandidates.find((text) => /^\d+(?:,\d+)?\s*€$/.test(text)) ??
      textCandidates.find((text) => /\d+(?:,\d+)?\s*€/.test(text));
    const imageCandidates = card
      .find("img")
      .toArray()
      .map((element) => $(element).attr("src"))
      .filter(
        (src): src is string => typeof src === "string" && src.length > 0,
      );
    const image =
      imageCandidates.find(
        (src) =>
          src.includes("/medias/") ||
          (/\.(?:jpe?g|png|webp)(?:$|\?)/i.test(src) &&
            !src.includes("/images/cards/")),
      ) ?? imageCandidates[0];
    const linkText = productLink.text().trim();
    const name = title ?? (linkText.length > 0 ? linkText : undefined);
    const url = productLink.attr("href") ?? undefined;
    const normalizedUrl = normalizeUrl(url) ?? url;

    if (!name || !normalizedUrl) {
      return;
    }

    // Extract product ID from URL: /p/<product-name>-<product-id>
    const idMatch = normalizedUrl.match(/-([\d]+)(?:\?|$)/);
    const id = idMatch ? idMatch[1] : undefined;

    products.push({
      name,
      url: normalizedUrl,
      id,
      price: parsePriceText(priceText),
      currency: priceText?.includes("€") ? "EUR" : undefined,
      image: normalizeUrl(image),
    });
  });

  return products;
}

function normalizeUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  if (url.startsWith("/")) {
    return `https://www.carrefour.fr${url}`;
  }
  return `https://www.carrefour.fr/${url}`;
}

function dedupeProducts(products: Product[]): Product[] {
  const seen = new Set<string>();
  const output: Product[] = [];

  for (const product of products) {
    if (seen.has(product.url)) {
      continue;
    }
    seen.add(product.url);
    output.push(product);
  }

  return output;
}

export async function searchCarrefourProducts(
  query: string,
  limit: number,
): Promise<SearchProductsResult> {
  const url = `${SEARCH_BASE_URL}?q=${encodeURIComponent(query)}`;

  const pageData = await loadSearchPageDataWithCache(url);
  const products = dedupeProducts(pageData.products).slice(0, limit);

  return {
    query,
    count: products.length,
    products,
  };
}

export const __testing = {
  buildSearchCacheConfigFromEnv,
  extractProductsFromRenderedHtml,
  loadSearchPageDataWithCache,
  normalizeUrl,
  parsePriceText,
  dedupeProducts,
};
