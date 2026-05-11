import * as cheerio from "cheerio";
import { chromium } from "playwright";
import { createCarrefourContext } from "../auth/session.js";
import { getSharedBrowser } from "../playwright.js";

const ORDER_DETAILS_BASE_URL =
  "https://www.carrefour.fr/mon-compte/mes-achats/en-ligne";

export type OrderDetails = {
  id: string;
  url: string;
  orderedAt?: string;
  billed?: boolean;
  deliveryType?: string;
  deliveryAddress?: string;
  deliverySlot?: string;
  total?: number;
  currency?: string;
  invoiceUrl?: string;
  reorderUrl?: string;
  refundUrl?: string;
  unavailableProductsCount?: number;
  products?: OrderProduct[];
};

export type OrderProduct = {
  name: string;
  productId?: string;
  unavailable: boolean;
  quantity?: number;
  packaging?: string;
  totalPrice?: number;
  unitPrice?: number;
  currency?: string;
  url?: string;
};

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

function normalizeDateToIso(rawDate: string | undefined): string | undefined {
  if (!rawDate) {
    return undefined;
  }

  const match = rawDate.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (!match) {
    return undefined;
  }

  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const yearRaw = Number.parseInt(match[3], 10);

  if (
    !Number.isFinite(day) ||
    !Number.isFinite(month) ||
    day < 1 ||
    day > 31 ||
    month < 1 ||
    month > 12
  ) {
    return undefined;
  }

  const year = match[3].length === 2 ? 2000 + yearRaw : yearRaw;
  const isoYear = year.toString().padStart(4, "0");
  const isoMonth = month.toString().padStart(2, "0");
  const isoDay = day.toString().padStart(2, "0");
  return `${isoYear}-${isoMonth}-${isoDay}`;
}

function parseCurrencyAmount(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/(\d+(?:,\d{2})?)\s*€/);
  if (!match) {
    return undefined;
  }

  const amount = Number.parseFloat(match[1].replace(",", "."));
  return Number.isFinite(amount) ? amount : undefined;
}

function parseBilledFlag(text: string): boolean | undefined {
  if (/\bfactur[ée]e\b/i.test(text)) {
    return true;
  }
  if (/\bnon\s+factur[ée]e\b/i.test(text)) {
    return false;
  }
  return undefined;
}

function extractProductIdFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const pathname = new URL(url).pathname;
    const slugIdMatch = pathname.match(
      /\/(?:p|produit)\/[^/?#]*?-(\d{6,})(?:$|[/?#])/i,
    );
    if (slugIdMatch?.[1]) {
      return slugIdMatch[1];
    }

    const plainIdMatch = pathname.match(
      /\/(?:p|produit)\/(\d{6,})(?:$|[/?#])/i,
    );
    return plainIdMatch?.[1];
  } catch {
    return undefined;
  }
}

function parseDeliverySlot(text: string): string | undefined {
  const match = text.match(/\b\d{1,2}h\d{2}\s*-\s*\d{1,2}h\d{2}\b/i);
  return match?.[0]?.replace(/\s+/g, " ").trim();
}

function parseUnavailableProductsCount(text: string): number | undefined {
  const match = text.match(/(\d+)\s+produits?\s+indisponibles?/i);
  if (!match) {
    return undefined;
  }

  const count = Number.parseInt(match[1], 10);
  return Number.isFinite(count) ? count : undefined;
}

function parsePriceValues(text: string): number[] {
  const matches = Array.from(
    text.matchAll(/(\d+(?:[ .]\d{3})*(?:\s*,\s*\d{2})?)\s*€/g),
  );
  return matches
    .map((match) => {
      const normalized = match[1]
        .replace(/\s*,\s*/g, ",")
        .replace(/[ .](?=\d{3}(?:\D|$))/g, "")
        .replace(",", ".");
      const value = Number.parseFloat(normalized);
      return Number.isFinite(value) ? value : undefined;
    })
    .filter((value): value is number => value !== undefined);
}

function parseQuantity(text: string): number | undefined {
  const patterns = [
    /\bqt[eé]\s*[:.]?\s*(\d+)\b/i,
    /\b(\d+)\s*x\b/i,
    /\bx\s*(\d+)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const quantity = Number.parseInt(match[1], 10);
    if (Number.isFinite(quantity)) {
      return quantity;
    }
  }

  return undefined;
}

function parseProductsFromHtml($: cheerio.CheerioAPI): OrderProduct[] {
  const products: OrderProduct[] = [];
  const seenByProduct = new Map<string, number>();

  const productCards = $(".order-product-card").toArray();
  for (const element of productCards) {
    const $card = $(element);

    const link = $card.find("a.order-product-container[href]").first();
    const url = normalizeUrl(link.attr("href") ?? undefined);
    const productId = extractProductIdFromUrl(url);

    const title = collapseWhitespace(
      $card.find(".order-product-container__title").first().text(),
    );
    const brand = collapseWhitespace(
      $card.find(".order-product-container__brand").first().text(),
    );
    const packaging = collapseWhitespace(
      $card.find(".order-product-container__packaging").first().text(),
    );

    const name = title || brand;
    if (!name) {
      continue;
    }

    const quantityText = collapseWhitespace(
      $card.find(".order-product-container__quantity").first().text(),
    );
    const quantity = parseQuantity(quantityText);

    const priceText = collapseWhitespace(
      $card.find(".order-product-container__price").first().text(),
    );
    const prices = parsePriceValues(priceText);
    const totalPrice =
      prices.length > 0 ? prices[prices.length - 1] : undefined;
    const unitPrice = prices.length > 1 ? prices[0] : undefined;

    const statusText = collapseWhitespace(
      $card.find(".order-product-card-quantity-change__label").first().text(),
    );
    const cardText = collapseWhitespace($card.text());
    const unavailable =
      /non\s+livr[ée],\s*non\s+factur[ée]/i.test(statusText) ||
      /indisponible|non\s+livr[ée]|non\s+factur[ée]/i.test(cardText) ||
      $card.find(".order-product-container__image--disabled").length > 0 ||
      $card.find(".product-price--crossed-out").length > 0;

    const key = url ?? `${name}|${packaging}`;
    const existingIndex = seenByProduct.get(key);

    if (existingIndex !== undefined) {
      const previous = products[existingIndex];
      if (!previous.unavailable && unavailable) {
        products[existingIndex] = {
          ...previous,
          productId: previous.productId ?? productId,
          unavailable: true,
          quantity: quantity ?? previous.quantity,
          totalPrice: totalPrice ?? previous.totalPrice,
          unitPrice: unitPrice ?? previous.unitPrice,
          packaging: packaging || previous.packaging,
          currency:
            totalPrice !== undefined || unitPrice !== undefined
              ? "EUR"
              : previous.currency,
        };
      }
      continue;
    }

    seenByProduct.set(key, products.length);
    products.push({
      name,
      productId,
      unavailable,
      quantity,
      packaging: packaging || undefined,
      totalPrice,
      unitPrice,
      currency:
        totalPrice !== undefined || unitPrice !== undefined ? "EUR" : undefined,
      url,
    });
  }

  if (products.length === 0) {
    const fallbackLinks = $("a[href*='/p/'], a[href*='/produit/']").toArray();
    for (const linkElement of fallbackLinks) {
      const $link = $(linkElement);
      const name = collapseWhitespace($link.text());
      if (!name) {
        continue;
      }

      const url = normalizeUrl($link.attr("href") ?? undefined);
      const productId = extractProductIdFromUrl(url);
      const key = url ?? name;
      if (seenByProduct.has(key)) {
        continue;
      }

      seenByProduct.set(key, products.length);
      products.push({
        name,
        productId,
        unavailable: false,
        url,
      });
    }
  }

  return products;
}

function resolveOrderDetailsUrl(orderRef: string): string {
  const normalized = orderRef.trim();
  if (!normalized) {
    throw new Error("orderRef must not be empty");
  }

  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return normalized;
  }

  const idMatch = normalized.match(/^(\d{6,})$/);
  if (!idMatch) {
    throw new Error(
      "orderRef must be an absolute URL or a numeric order id (at least 6 digits)",
    );
  }

  return `${ORDER_DETAILS_BASE_URL}/${idMatch[1]}`;
}

function isCloudflareChallengeHtml(html: string): boolean {
  const lowerHtml = html.toLowerCase();
  return (
    lowerHtml.includes(
      "vérifions ensemble que vous n\u2019êtes pas un robot",
    ) ||
    lowerHtml.includes("verifions ensemble que vous n'etes pas un robot") ||
    lowerHtml.includes("c\u2019est une formalité") ||
    lowerHtml.includes("c'est une formalite") ||
    lowerHtml.includes("ray id") ||
    lowerHtml.includes("un instant")
  );
}

function extractOrderDetailsFromHtml(
  html: string,
  fallbackUrl: string,
): OrderDetails {
  const $ = cheerio.load(html);
  const bodyText = collapseWhitespace($("body").text());
  const products = parseProductsFromHtml($);

  const titleText = collapseWhitespace($("h1, title").first().text());
  const idFromText =
    bodyText.match(/\bN°\s*(\d{6,})\b/i)?.[1] ??
    titleText.match(/\bN°\s*(\d{6,})\b/i)?.[1] ??
    fallbackUrl.match(/\/(\d{6,})(?:\?|$)/)?.[1];

  if (!idFromText) {
    throw new Error("Unable to extract order id from detail page.");
  }

  const orderedAt = normalizeDateToIso(
    bodyText.match(
      /Sur\s+Carrefour\.fr\s+le\s+(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
    )?.[1],
  );

  const total = parseCurrencyAmount(
    bodyText.match(
      /D[ée]tail\s+de\s+la\s+commande\s+Total\s+(\d+(?:,\d{2})?\s*€)/i,
    )?.[1] ?? bodyText.match(/\bTotal\s+(\d+(?:,\d{2})?\s*€)/i)?.[1],
  );

  const deliveryType =
    bodyText
      .match(/Adresse\s+de\s+livraison\s+([^0-9][A-Za-zÀ-ÿ' -]+?)\s+\d+/i)?.[1]
      ?.trim() ??
    bodyText
      .match(/Adresse\s+de\s+livraison\s+(.+?)\s+Livraison\s+estim[ée]e/i)?.[1]
      ?.trim();

  const deliveryAddress =
    bodyText
      .match(
        /Adresse\s+de\s+livraison\s+.+?\s+(\d+\s+[^]+?)\s+Livraison\s+estim[ée]e/i,
      )?.[1]
      ?.trim() ?? undefined;

  const deliverySlot = parseDeliverySlot(bodyText);
  const billed = parseBilledFlag(bodyText);

  const invoiceUrl = normalizeUrl(
    $("a[href*='/mes-achats/facture/']").first().attr("href") ?? undefined,
  );
  const reorderUrl = normalizeUrl(
    $("a[href*='/mes-achats/en-ligne/commander/']").first().attr("href") ??
      undefined,
  );
  const refundUrl = normalizeUrl(
    $("a[href*='/mes-achats/remboursement/']").first().attr("href") ??
      undefined,
  );

  return {
    id: idFromText,
    url: resolveOrderDetailsUrl(fallbackUrl),
    orderedAt,
    billed,
    deliveryType,
    deliveryAddress,
    deliverySlot,
    total,
    currency: total !== undefined ? "EUR" : undefined,
    invoiceUrl,
    reorderUrl,
    refundUrl,
    unavailableProductsCount: parseUnavailableProductsCount(bodyText),
    products,
  };
}

async function loadOrderDetailsHtml(url: string): Promise<string> {
  const browser = await getSharedBrowser();
  const context = await createCarrefourContext(browser, {
    useAuth: true,
    requireAuth: true,
  });

  try {
    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    if (!response) {
      throw new Error(
        "Carrefour order details page did not return a response.",
      );
    }

    await page
      .waitForLoadState("networkidle", { timeout: 7000 })
      .catch(() => undefined);

    const html = await page.content();
    if (isCloudflareChallengeHtml(html)) {
      throw new Error(
        "Cloudflare challenge detected while reading order details. Use an authenticated browser session.",
      );
    }

    return html;
  } finally {
    await context.close();
  }
}

async function loadOrderDetailsHtmlFromCdp(
  url: string,
  cdpUrl: string,
): Promise<string> {
  const browser = await chromium.connectOverCDP(cdpUrl);

  try {
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error(
        "No browser context found on CDP target. Open a normal browsing window first.",
      );
    }

    const page = context.pages()[0] ?? (await context.newPage());
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    if (!response) {
      throw new Error(
        "Carrefour order details page did not return a response.",
      );
    }

    await page
      .waitForLoadState("networkidle", { timeout: 7000 })
      .catch(() => undefined);

    const html = await page.content();
    if (isCloudflareChallengeHtml(html)) {
      throw new Error(
        "Cloudflare challenge detected while reading order details. Use an authenticated browser session.",
      );
    }

    return html;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function getCarrefourOrderDetails(
  orderRef: string,
  cdpUrl?: string,
): Promise<OrderDetails> {
  const targetUrl = resolveOrderDetailsUrl(orderRef);
  const html = cdpUrl
    ? await loadOrderDetailsHtmlFromCdp(targetUrl, cdpUrl)
    : await loadOrderDetailsHtml(targetUrl);

  return extractOrderDetailsFromHtml(html, targetUrl);
}

export const __testing = {
  extractOrderDetailsFromHtml,
  normalizeDateToIso,
  parseBilledFlag,
  parseDeliverySlot,
  parseUnavailableProductsCount,
  parseProductsFromHtml,
  resolveOrderDetailsUrl,
};
