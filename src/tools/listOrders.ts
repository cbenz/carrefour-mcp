import * as cheerio from "cheerio";
import { readFile } from "node:fs/promises";
import { chromium, request as playwrightRequest } from "playwright";
import { buildAuthConfigFromEnv } from "../auth/session.js";

const ORDERS_API_URL = "https://www.carrefour.fr/api/user/orders";
const ORDERS_PAGE_URL =
	"https://www.carrefour.fr/mon-compte/mes-achats/en-ligne";

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

type OrdersRange = {
	startIso: string;
	endIso: string;
	startFr: string;
	endFr: string;
};

// ─── API response types ────────────────────────────────────────────────────────

type ApiSlot = { dateBegin: string; dateEnd: string } | null;

type ApiOrderItem = {
	attributes: {
		orderNumber: string;
		date: string; // "YYYY-MM-DD HH:MM:SS"
		totalAmount: number;
		orderStatus: string;
		serviceType: string;
		slot: ApiSlot;
		isPaidOnSite: boolean;
		paymentInfos: unknown[];
	};
	links: {
		orderDetailsPage: string;
		getStatement: string | null;
	};
};

type OrdersApiPage = {
	data: ApiOrderItem[];
	meta: {
		scrollPaging?: string;
		scrollHash?: string;
	};
};

type ScrollCursor = {
	scrollPaging: string;
	scrollHash: string;
};

// ─── Shared helpers ────────────────────────────────────────────────────────────

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

// ─── API mapping ───────────────────────────────────────────────────────────────

function formatApiTimeSlot(slot: ApiSlot): string | undefined {
	if (!slot?.dateBegin || !slot?.dateEnd) {
		return undefined;
	}
	const beginMatch = slot.dateBegin.match(/(\d{2}):(\d{2}):/);
	const endMatch = slot.dateEnd.match(/(\d{2}):(\d{2}):/);
	if (!beginMatch || !endMatch) {
		return undefined;
	}
	return `${beginMatch[1]}h${beginMatch[2]} - ${endMatch[1]}h${endMatch[2]}`;
}

export function extractOrdersFromApiResponse(
	items: ApiOrderItem[],
): OrderSummary[] {
	return items.map((item) => ({
		id: item.attributes.orderNumber,
		date: item.attributes.date.slice(0, 10),
		total: item.attributes.totalAmount,
		currency: "EUR",
		status: item.attributes.orderStatus,
		timeSlot: formatApiTimeSlot(item.attributes.slot),
		billed: item.links.getStatement !== null ? true : undefined,
		detailUrl: normalizeUrl(item.links.orderDetailsPage),
	}));
}

// ─── Auth state helpers ────────────────────────────────────────────────────────

type PlaywrightStorageState = {
	cookies: Array<{
		name: string;
		value: string;
		domain: string;
		path: string;
		expires: number;
		httpOnly: boolean;
		secure: boolean;
		sameSite: "Strict" | "Lax" | "None";
	}>;
	origins: Array<{
		origin: string;
		localStorage: Array<{ name: string; value: string }>;
	}>;
};

async function readAuthState(): Promise<PlaywrightStorageState> {
	const config = buildAuthConfigFromEnv();

	let rawState: string;
	try {
		rawState = await readFile(config.statePath, { encoding: "utf-8" });
	} catch {
		throw new Error(
			"Carrefour auth state not found. Run auth_login then auth_capture_state first.",
		);
	}

	const state = JSON.parse(rawState) as PlaywrightStorageState;
	if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
		throw new Error(
			"Invalid auth state. Run auth_login then auth_capture_state first.",
		);
	}

	return state;
}

// ─── API pagination (uses Playwright request context for browser TLS fingerprint) ─

type DateFilter = { startDate?: string; endDate?: string };

async function fetchOrdersApiPage(
	apiContext: import("playwright").APIRequestContext,
	dateFilter: DateFilter,
	cursor?: ScrollCursor,
): Promise<{ orders: OrderSummary[]; nextCursor: ScrollCursor | undefined }> {
	const url = new URL(ORDERS_API_URL);
	url.searchParams.set("page", "1");
	url.searchParams.set("pageSize", "20");
	if (cursor) {
		url.searchParams.set("scrollPaging", cursor.scrollPaging);
		url.searchParams.set("scrollHash", cursor.scrollHash);
	}
	if (dateFilter.startDate) {
		url.searchParams.set("startDate", dateFilter.startDate);
	}
	if (dateFilter.endDate) {
		url.searchParams.set("endDate", dateFilter.endDate);
	}

	const response = await apiContext.get(url.toString(), {
		headers: {
			Accept: "application/json",
			Referer: ORDERS_PAGE_URL,
			Origin: "https://www.carrefour.fr",
			"X-Requested-With": "XMLHttpRequest",
		},
	});

	if (response.status() === 401 || response.status() === 403) {
		throw new Error(
			`Carrefour API returned ${response.status()}. The session may be expired; run auth_login then auth_capture_state again.`,
		);
	}

	if (!response.ok()) {
		throw new Error(
			`Carrefour API returned unexpected status ${response.status()}.`,
		);
	}

	const json = (await response.json()) as OrdersApiPage;
	const nextScrollPaging = json.meta?.scrollPaging;
	const nextScrollHash = json.meta?.scrollHash;
	return {
		orders: extractOrdersFromApiResponse(json.data ?? []),
		nextCursor:
			nextScrollPaging && nextScrollHash
				? { scrollPaging: nextScrollPaging, scrollHash: nextScrollHash }
				: undefined,
	};
}

async function fetchAllOrdersViaApi(
	apiContext: import("playwright").APIRequestContext,
	limit: number | undefined,
	dateFilter: DateFilter,
): Promise<OrderSummary[]> {
	const allOrders: OrderSummary[] = [];
	const seenOrderKeys = new Set<string>();
	const seenPageSignatures = new Set<string>();
	let cursor: ScrollCursor | undefined = undefined;

	while (limit === undefined || allOrders.length < limit) {
		const { orders, nextCursor } = await fetchOrdersApiPage(
			apiContext,
			dateFilter,
			cursor,
		);

		const signature = orders
			.map((order) => order.id ?? order.detailUrl ?? "")
			.join("|");
		if (signature && seenPageSignatures.has(signature)) {
			break;
		}
		if (signature) {
			seenPageSignatures.add(signature);
		}

		let added = 0;
		for (const order of orders) {
			const key = order.id ?? order.detailUrl;
			if (!key) {
				allOrders.push(order);
				added += 1;
				continue;
			}
			if (seenOrderKeys.has(key)) {
				continue;
			}
			seenOrderKeys.add(key);
			allOrders.push(order);
			added += 1;
		}

		if (orders.length === 0) {
			break;
		}
		if (!nextCursor || added === 0) {
			break;
		}
		cursor = nextCursor;
	}

	if (limit === undefined) {
		return allOrders;
	}

	return allOrders.slice(0, limit);
}

async function fetchOrdersFromAuthState(
	limit: number | undefined,
	dateFilter: DateFilter,
): Promise<OrderSummary[]> {
	const storageState = await readAuthState();
	const apiContext = await playwrightRequest.newContext({
		storageState,
		baseURL: "https://www.carrefour.fr",
	});
	try {
		return await fetchAllOrdersViaApi(apiContext, limit, dateFilter);
	} finally {
		await apiContext.dispose();
	}
}

async function fetchOrdersFromCdp(
	cdpUrl: string,
	limit: number | undefined,
	dateFilter: DateFilter,
): Promise<OrderSummary[]> {
	const browser = await chromium.connectOverCDP(cdpUrl);
	try {
		const context = browser.contexts()[0];
		if (!context) {
			throw new Error(
				"No browser context found on CDP target. Open a normal browsing window first.",
			);
		}
		// Use the live browser context's request so cookies are already attached.
		const apiContext = context.request;
		return await fetchAllOrdersViaApi(apiContext, limit, dateFilter);
	} finally {
		await browser.close().catch(() => undefined);
	}
}

// ─── HTML parsing helpers (kept for __testing exports) ────────────────────────

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
		/(\d{2}\/\d{2}\/\d{4})\s*-\s*([A-Za-zÀ-ÿ0-9'' -]{3,100}?)\s*(\d{1,5},\d{2})\s*€/g;

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

function sortOrdersByDateDesc(orders: OrderSummary[]): OrderSummary[] {
	return [...orders].sort((a, b) => {
		if (a.date && b.date) {
			return b.date.localeCompare(a.date);
		}
		if (a.date) {
			return -1;
		}
		if (b.date) {
			return 1;
		}
		return 0;
	});
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function listCarrefourOrders(
	limit?: number,
	cdpUrl?: string,
	startDate?: string,
	endDate?: string,
): Promise<ListOrdersResult> {
	const dateFilter: DateFilter = { startDate, endDate };
	const fetchedOrders = cdpUrl
		? await fetchOrdersFromCdp(cdpUrl, limit, dateFilter)
		: await fetchOrdersFromAuthState(limit, dateFilter);
	const orders = sortOrdersByDateDesc(fetchedOrders);
	return {
		count: orders.length,
		orders,
	};
}

export const __testing = {
	extractOrdersFromApiResponse,
	extractOrdersFromHtml,
	extractOrdersFromDashboardText,
	hasNoOrdersMarker,
	isCloudflareChallengeHtml,
	parseBilledFlag,
	parseOrderTimeSlot,
	sortOrdersByDateDesc,
};
