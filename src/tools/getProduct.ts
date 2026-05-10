import * as cheerio from "cheerio";
import { chromium, type Browser } from "playwright";

export type ProductUnitPrice = {
  value: number;
  unit: string;
  raw: string;
};

export type ProductNutritionFact = {
  label: string;
  value: string;
};

export type ProductDetails = {
  source: "carrefour.fr";
  name: string;
  url: string;
  brand?: string;
  quantity?: string;
  price?: number;
  currency?: string;
  unitPrice?: ProductUnitPrice;
  nutriScore?: string;
  ingredients?: string;
  description?: string;
  nutritionFacts: ProductNutritionFact[];
  images: string[];
};

type LdJsonProduct = {
  name?: string;
  brand?: string;
  url?: string;
  image?: string | string[];
  offers?: {
    price?: number;
    priceCurrency?: string;
  };
};

type ParsedQuantity = {
  value: number;
  unit: "l" | "ml" | "kg" | "g";
};

const DEFAULT_CURRENCY = "EUR";

let browserPromise: Promise<Browser> | undefined;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({ headless: true })
      .catch((error) => {
        browserPromise = undefined;
        throw error;
      });
  }

  return browserPromise;
}

export async function closeProductBrowser(): Promise<void> {
  if (!browserPromise) {
    return;
  }

  const browser = await browserPromise.catch(() => undefined);
  browserPromise = undefined;

  if (browser) {
    await browser.close();
  }
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

function parseFrenchDecimal(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDisplayedFrenchNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const compact = value.replace(/\s+/g, "");
  return parseFrenchDecimal(compact);
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseLdJsonProduct(html: string): LdJsonProduct | undefined {
  const $ = cheerio.load(html);

  for (const script of $('script[type="application/ld+json"]').toArray()) {
    const raw = $(script).html();
    if (!raw) {
      continue;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const nodes = Array.isArray(parsed) ? parsed : [parsed];

      for (const node of nodes) {
        if (!node || typeof node !== "object") {
          continue;
        }

        if ((node as { "@type"?: unknown })["@type"] !== "Product") {
          continue;
        }

        const maybeProduct = node as {
          name?: unknown;
          brand?: { name?: unknown } | unknown;
          url?: unknown;
          image?: unknown;
          offers?: { price?: unknown; priceCurrency?: unknown } | unknown;
        };

        const name =
          typeof maybeProduct.name === "string" ? maybeProduct.name : undefined;
        const brand =
          maybeProduct.brand && typeof maybeProduct.brand === "object"
            ? typeof (maybeProduct.brand as { name?: unknown }).name === "string"
              ? (maybeProduct.brand as { name?: string }).name
              : undefined
            : undefined;
        const url =
          typeof maybeProduct.url === "string" ? maybeProduct.url : undefined;
        const image =
          typeof maybeProduct.image === "string" || Array.isArray(maybeProduct.image)
            ? (maybeProduct.image as string | string[])
            : undefined;

        let price: number | undefined;
        let priceCurrency: string | undefined;
        if (maybeProduct.offers && typeof maybeProduct.offers === "object") {
          const offers = maybeProduct.offers as {
            price?: unknown;
            priceCurrency?: unknown;
          };
          if (typeof offers.price === "number") {
            price = Number.isFinite(offers.price) ? offers.price : undefined;
          } else if (typeof offers.price === "string") {
            price = parseFrenchDecimal(offers.price);
          }
          if (typeof offers.priceCurrency === "string") {
            priceCurrency = offers.priceCurrency;
          }
        }

        return {
          name,
          brand,
          url,
          image,
          offers: {
            price,
            priceCurrency,
          },
        };
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return undefined;
}

function extractPriceFromDomText(text: string): number | undefined {
  const match = text.match(/(\d+\s*,\s*\d{2}|\d+)\s*€/);
  if (!match) {
    return undefined;
  }

  return parseDisplayedFrenchNumber(match[1]);
}

function extractUnitPrice(text: string): ProductUnitPrice | undefined {
  const match = text.match(
    /(\d+\s*,\s*\d{2}|\d+(?:,\d+)?)\s*€\s*\/\s*(100\s?(?:g|ml)|kg|g|l|ml)/i,
  );

  if (!match) {
    return undefined;
  }

  const value = parseDisplayedFrenchNumber(match[1]);
  if (!value) {
    return undefined;
  }

  return {
    value,
    unit: match[2].replace(/\s+/g, "").toLowerCase(),
    raw: collapseWhitespace(match[0]),
  };
}

function parseQuantity(raw: string | undefined): ParsedQuantity | undefined {
  if (!raw) {
    return undefined;
  }

  const match = raw.match(/(\d+(?:[.,]\d+)?)\s*(l|ml|kg|g)/i);
  if (!match) {
    return undefined;
  }

  const value = parseDisplayedFrenchNumber(match[1]);
  if (!value) {
    return undefined;
  }

  const unit = match[2].toLowerCase() as ParsedQuantity["unit"];
  return {
    value,
    unit,
  };
}

function computeUnitPriceFromPriceAndQuantity(
  price: number | undefined,
  quantity: string | undefined,
): ProductUnitPrice | undefined {
  if (!price || !quantity) {
    return undefined;
  }

  const parsedQuantity = parseQuantity(quantity);
  if (!parsedQuantity) {
    return undefined;
  }

  if (parsedQuantity.unit === "l") {
    return {
      value: Number((price / parsedQuantity.value).toFixed(2)),
      unit: "l",
      raw: `${price.toFixed(2).replace(".", ",")} € / ${quantity}`,
    };
  }

  if (parsedQuantity.unit === "ml") {
    const liters = parsedQuantity.value / 1000;
    if (liters <= 0) {
      return undefined;
    }
    return {
      value: Number((price / liters).toFixed(2)),
      unit: "l",
      raw: `${price.toFixed(2).replace(".", ",")} € / ${quantity}`,
    };
  }

  if (parsedQuantity.unit === "kg") {
    return {
      value: Number((price / parsedQuantity.value).toFixed(2)),
      unit: "kg",
      raw: `${price.toFixed(2).replace(".", ",")} € / ${quantity}`,
    };
  }

  const kilos = parsedQuantity.value / 1000;
  if (kilos <= 0) {
    return undefined;
  }
  return {
    value: Number((price / kilos).toFixed(2)),
    unit: "kg",
    raw: `${price.toFixed(2).replace(".", ",")} € / ${quantity}`,
  };
}

function selectReliableUnitPrice(
  extracted: ProductUnitPrice | undefined,
  computed: ProductUnitPrice | undefined,
): ProductUnitPrice | undefined {
  if (!extracted) {
    return computed;
  }

  if (!computed) {
    return extracted;
  }

  if (extracted.unit !== computed.unit) {
    return extracted;
  }

  const relativeGap = Math.abs(extracted.value - computed.value) / computed.value;
  return relativeGap > 0.5 ? computed : extracted;
}

function extractNutriScore($: cheerio.CheerioAPI): string | undefined {
  const nutriCandidate = $(
    '[aria-label*="Nutri-Score"], img[alt*="Nutri-Score"], button:contains("Nutri-Score")',
  )
    .first()
    .attr("aria-label")
    ??
    $(
      '[aria-label*="Nutri-Score"], img[alt*="Nutri-Score"], button:contains("Nutri-Score")',
    )
      .first()
      .attr("alt")
    ??
    $(
      '[aria-label*="Nutri-Score"], img[alt*="Nutri-Score"], button:contains("Nutri-Score")',
    )
      .first()
      .text();

  if (!nutriCandidate) {
    return undefined;
  }

  const match = nutriCandidate.match(/Nutri-Score\s*:\s*([A-E])/i);
  return match?.[1]?.toUpperCase();
}

function extractSectionText(fullText: string, sectionTitle: RegExp, nextTitle: RegExp): string | undefined {
  const startMatch = fullText.search(sectionTitle);
  if (startMatch < 0) {
    return undefined;
  }

  const fromStart = fullText.slice(startMatch);
  const endMatch = fromStart.search(nextTitle);
  const rawSection = endMatch >= 0 ? fromStart.slice(0, endMatch) : fromStart;

  const cleaned = collapseWhitespace(
    rawSection
      .replace(sectionTitle, "")
      .replace(/Voir plus/gi, "")
      .replace(/Taux d'apports journaliers/gi, ""),
  );

  return cleaned.length > 0 ? cleaned : undefined;
}

function extractNutritionFacts(fullText: string): ProductNutritionFact[] {
  const facts: ProductNutritionFact[] = [];
  const regex =
    /(Valeur énergétique \(kJ\)|Valeur énergétique \(kcal\)|Matières grasses|dont acides gras saturés|Glucides|dont sucres|Fibres alimentaires|Protéines|Sel)\s*([0-9.,]+\s*(?:kJ|kcal|g|mg)\s*\/\s*100)/gi;

  for (const match of fullText.matchAll(regex)) {
    facts.push({
      label: collapseWhitespace(match[1]),
      value: collapseWhitespace(match[2]),
    });
  }

  return facts;
}

function extractProductDetailsFromHtml(
  html: string,
  fallbackUrl: string,
): ProductDetails {
  const $ = cheerio.load(html);
  const fullText = collapseWhitespace($("body").text());
  const ldProduct = parseLdJsonProduct(html);

  const domName = collapseWhitespace($("h1").first().text());
  const name = domName || ldProduct?.name || "Unknown product";

  const canonicalUrl = normalizeUrl($("link[rel='canonical']").attr("href"));
  const url = canonicalUrl ?? normalizeUrl(ldProduct?.url) ?? normalizeUrl(fallbackUrl) ?? fallbackUrl;

  const normalizedName = name.toLowerCase();
  const images = Array.from(
    new Set(
      $("main img")
        .toArray()
        .map((img) => ({
          src: normalizeUrl($(img).attr("src")),
          alt: collapseWhitespace($(img).attr("alt") ?? "").toLowerCase(),
        }))
        .filter(
          (image) =>
            typeof image.src === "string" &&
            !image.src.startsWith("data:") &&
            (image.src.includes("media.carrefour.fr/medias/") ||
              image.src.includes("/medias/")) &&
            (normalizedName.length === 0 || image.alt.includes(normalizedName)),
        )
        .map((image) => image.src as string)
        .slice(0, 12),
    ),
  );

  const titleQuantity =
    collapseWhitespace($("title").text()).match(
      /:\s*(\d+(?:[.,]\d+)?\s*(?:L|ml|kg|g))\s+à\s+Prix/i,
    )?.[1] ?? undefined;

  const quantityFromButtons =
    $("h1")
      .first()
      .parent()
      .find("button")
      .toArray()
      .map((button) => collapseWhitespace($(button).text()))
      .find((text) => /^\d+(?:[.,]\d+)?\s*(l|ml|kg|g)$/i.test(text))
    ?? undefined;

  const quantity = quantityFromButtons ?? titleQuantity;
  const domPrice = extractPriceFromDomText(fullText);
  const price = domPrice ?? ldProduct?.offers?.price;
  const currency = ldProduct?.offers?.priceCurrency ?? (price ? DEFAULT_CURRENCY : undefined);
  const extractedUnitPrice = extractUnitPrice(fullText);
  const computedUnitPrice = computeUnitPriceFromPriceAndQuantity(price, quantity);
  const unitPrice = selectReliableUnitPrice(extractedUnitPrice, computedUnitPrice);

  const ingredients = extractSectionText(
    fullText,
    /Ingrédients \(dont ALLERGÈNES\)/i,
    /Description|Valeurs nutritionnelles|Voir tous les produits du rayon/i,
  )?.replace(/\.([A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜ])/g, ". $1");

  const description = extractSectionText(
    fullText,
    /Description/i,
    /Valeurs nutritionnelles|Voir tous les produits du rayon|Paiement 100% sécurisé/i,
  );

  const nutritionFacts = extractNutritionFacts(fullText);

  return {
    source: "carrefour.fr",
    name,
    url,
    brand: ldProduct?.brand,
    quantity,
    price,
    currency,
    unitPrice,
    nutriScore: extractNutriScore($),
    ingredients,
    description,
    nutritionFacts,
    images:
      images.length > 0
        ? images
        : (Array.isArray(ldProduct?.image) ? ldProduct.image : [ldProduct?.image])
            .map((image) => normalizeUrl(image))
            .filter((image): image is string => typeof image === "string"),
  };
}

export async function getCarrefourProduct(
  productUrl: string,
): Promise<ProductDetails> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: "fr-FR",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    viewport: {
      width: 1440,
      height: 1200,
    },
  });

  try {
    const page = await context.newPage();
    const response = await page.goto(productUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    if (!response) {
      throw new Error("Carrefour product page did not return a response");
    }

    if (response.status() >= 400) {
      throw new Error(
        `Carrefour product request failed with status ${response.status()}`,
      );
    }

    await page
      .waitForLoadState("networkidle", { timeout: 10000 })
      .catch(() => undefined);

    const html = await page.content();
    return extractProductDetailsFromHtml(html, page.url());
  } finally {
    await context.close();
  }
}

export const __testing = {
  computeUnitPriceFromPriceAndQuantity,
  extractProductDetailsFromHtml,
  extractUnitPrice,
  parseLdJsonProduct,
  parseFrenchDecimal,
};
