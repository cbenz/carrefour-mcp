import * as cheerio from "cheerio";
import { chromium } from "playwright";
import { createCarrefourContext } from "../auth/session.js";
import { getSharedBrowser } from "../playwright.js";

const ORDERS_URL = "https://www.carrefour.fr/mon-compte/mes-achats/en-ligne";
const DEFAULT_CDP_URL = "http://127.0.0.1:9222";

export type OrderSummary = {
  id?: string;
  date?: string;
  total?: number;
  currency?: string;
  status?: string;
  timeSlot?: string;
  billed?: boolean;
  detailUrl?: string;
};

export type ListOrdersResult = {
  count: number;
  orders: OrderSummary[];
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

function parseOrderTotal(text: string): number | undefined {
  const matches = Array.from(text.matchAll(/(\d+(?:[.,]\d{2})?)\s*€/gi));
  if (matches.length === 0) {
    return undefined;
  }

  const total = Number.parseFloat(
    matches[matches.length - 1][1].replace(",", "."),
  );
  return Number.isFinite(total) ? total : undefined;
}

function parseOrderDate(text: string): string | undefined {
  const match = text.match(/\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/);
  return normalizeDateToIso(match?.[1]);
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

function parseOrderId(
  text: string,
  url: string | undefined,
): string | undefined {
  const textNumberMatch = text.match(/\bN°\s*(\d{6,})\b/i);
  if (textNumberMatch?.[1]) {
    return textNumberMatch[1];
  }

  const textMatch = text.match(
    /(?:commande|order)\s*(?:n°|#)?\s*([A-Z0-9-]{5,})/i,
  );
  if (textMatch?.[1]) {
    return textMatch[1];
  }

  if (!url) {
    return undefined;
  }

  const commanderMatch = url.match(/\/commander\/(\d+)/i);
  if (commanderMatch?.[1]) {
    return commanderMatch[1];
  }

  const urlMatch = url.match(
    /(?:commande|order)s?\/(?:details?\/)?([A-Z0-9-]{5,})/i,
  );
  return urlMatch?.[1];
}

function parseOrderTimeSlot(text: string): string | undefined {
  const match = text.match(/\b\d{1,2}h\d{2}\s*-\s*\d{1,2}h\d{2}\b/i);
  return match?.[0]?.replace(/\s+/g, " ").trim();
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

function selectOrderCardText(
  link: cheerio.Cheerio<any>,
  orderIdHint?: string,
): string {
  let current = link;
  let bestText = "";

  for (let depth = 0; depth < 7; depth += 1) {
    current = current.parent();
    if (current.length === 0) {
      break;
    }

    const text = collapseWhitespace(current.text());
    if (
      orderIdHint &&
      text.includes(orderIdHint) &&
      /\d+(?:[.,]\d{2})\s*€/i.test(text)
    ) {
      return text;
    }

    if (text.length <= bestText.length) {
      continue;
    }

    const looksLikeOrderCard =
      /\bN°\s*\d{6,}\b/i.test(text) ||
      /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/.test(text) ||
      /\d+(?:[.,]\d{2})\s*€/i.test(text) ||
      /\bVoir\s+le\s+d[ée]tail\b/i.test(text);

    if (looksLikeOrderCard) {
      bestText = text;
    }
  }

  return bestText;
}

function parseOrderStatus(text: string): string | undefined {
  const candidates = [
    "Livrée",
    "Livré",
    "En préparation",
    "En cours",
    "Expédiée",
    "Expédié",
    "Annulée",
    "Annulé",
  ];

  const lowerText = text.toLowerCase();
  return candidates.find((candidate) =>
    lowerText.includes(candidate.toLowerCase()),
  );
}

function extractOrdersFromDashboardText(html: string): OrderSummary[] {
  const $ = cheerio.load(html);
  const bodyText = collapseWhitespace($("body").text());

  const sectionMatch = bodyText.match(
    /Commandes\s+en\s+ligne\s+([\s\S]*?)(?:Voir\s+toutes\s+mes\s+commandes|Tickets\s+de\s+caisse\s+en\s+magasin|$)/i,
  );

  if (!sectionMatch?.[1]) {
    return [];
  }

  const section = sectionMatch[1];
  const orders: OrderSummary[] = [];
  const pattern =
    /(\d{2}\/\d{2}\/\d{4})\s*-\s*([A-Za-zÀ-ÿ0-9'’ -]{3,100}?)\s*(\d{1,5},\d{2})\s*€/g;

  for (const match of section.matchAll(pattern)) {
    const total = Number.parseFloat(match[3].replace(",", "."));
    orders.push({
      date: normalizeDateToIso(match[1]),
      total: Number.isFinite(total) ? total : undefined,
      currency: "EUR",
      status: collapseWhitespace(match[2]),
    });
  }

  return orders;
}

export function extractOrdersFromHtml(html: string): OrderSummary[] {
  const $ = cheerio.load(html);
  const uniqueOrders = new Map<string, OrderSummary>();

  $("a[href*='commande'], a[href*='order']").each((_, element) => {
    const link = $(element);
    const detailHref = link.attr("href");
    const detailUrl = normalizeUrl(detailHref);
    const orderIdFromUrl = detailUrl?.match(/\/commander\/(\d+)/i)?.[1];
    const text = selectOrderCardText(link, orderIdFromUrl);

    if (!detailUrl && text.length === 0) {
      return;
    }

    const order: OrderSummary = {
      id: parseOrderId(text, detailUrl),
      date: parseOrderDate(text),
      total: parseOrderTotal(text),
      currency: text.includes("€") ? "EUR" : undefined,
      status: parseOrderStatus(text),
      timeSlot: parseOrderTimeSlot(text),
      billed: parseBilledFlag(text),
      detailUrl,
    };

    const key = order.id ?? order.detailUrl ?? text;
    if (key && !uniqueOrders.has(key)) {
      uniqueOrders.set(key, order);
    }
  });

  if (uniqueOrders.size === 0) {
    const fallbackOrders = extractOrdersFromDashboardText(html);
    for (const fallbackOrder of fallbackOrders) {
      const key = `${fallbackOrder.date ?? ""}-${fallbackOrder.total ?? ""}-${fallbackOrder.status ?? ""}`;
      if (!uniqueOrders.has(key)) {
        uniqueOrders.set(key, fallbackOrder);
      }
    }
  }

  return Array.from(uniqueOrders.values());
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

function hasNoOrdersMarker(html: string): boolean {
  const lowerHtml = html.toLowerCase();
  return (
    lowerHtml.includes("aucune commande") ||
    lowerHtml.includes("pas encore de commande") ||
    lowerHtml.includes("vous n'avez pas encore de commande")
  );
}

function validateOrdersHtml(html: string): void {
  if (isCloudflareChallengeHtml(html)) {
    throw new Error(
      "Cloudflare challenge detected while reading orders. Use an authenticated Chrome session and run list_orders with --cdp-url, for example: list_orders --cdp-url http://127.0.0.1:9222.",
    );
  }

  const orders = extractOrdersFromHtml(html);
  if (orders.length === 0 && !hasNoOrdersMarker(html)) {
    throw new Error(
      "Unable to locate Carrefour orders page content. The session may be expired.",
    );
  }
}

async function openOrdersPageHtml(): Promise<string> {
  const browser = await getSharedBrowser();
  const context = await createCarrefourContext(browser, {
    useAuth: true,
    requireAuth: true,
  });

  try {
    const page = await context.newPage();
    const response = await page.goto(ORDERS_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    if (!response) {
      throw new Error("Carrefour orders page did not return a response.");
    }

    await page
      .waitForLoadState("networkidle", { timeout: 7000 })
      .catch(() => undefined);

    const html = await page.content();
    validateOrdersHtml(html);
    return html;
  } finally {
    await context.close();
  }
}

async function openOrdersPageHtmlFromCdp(cdpUrl: string): Promise<string> {
  const browser = await chromium.connectOverCDP(cdpUrl);

  try {
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error(
        "No browser context found on CDP target. Open a normal browsing window first.",
      );
    }

    const page = context.pages()[0] ?? (await context.newPage());
    const response = await page.goto(ORDERS_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    if (!response) {
      throw new Error("Carrefour orders page did not return a response.");
    }

    await page
      .waitForLoadState("networkidle", { timeout: 7000 })
      .catch(() => undefined);

    const html = await page.content();
    validateOrdersHtml(html);
    return html;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function listCarrefourOrders(
  limit = 20,
  cdpUrl?: string,
): Promise<ListOrdersResult> {
  const html = cdpUrl
    ? await openOrdersPageHtmlFromCdp(cdpUrl)
    : await openOrdersPageHtml();
  const orders = extractOrdersFromHtml(html).slice(0, limit);
  return {
    count: orders.length,
    orders,
  };
}

export const __testing = {
  DEFAULT_CDP_URL,
  extractOrdersFromHtml,
  extractOrdersFromDashboardText,
  hasNoOrdersMarker,
  isCloudflareChallengeHtml,
  parseBilledFlag,
  parseOrderTimeSlot,
};
