import * as cheerio from "cheerio";
import { readFile } from "node:fs/promises";
import { chromium, request as playwrightRequest } from "playwright";
import { buildAuthConfigFromEnv } from "../auth/session.js";

const ORDER_DETAILS_BASE_URL =
	"https://www.carrefour.fr/mon-compte/mes-achats/en-ligne";
const ORDERS_API_URL = "https://www.carrefour.fr/api/user/orders";

// ─── API response types ────────────────────────────────────────────────────────

type ApiOfferPrice = {
	price?: number;
	totalPrice?: {
		delivered?: number;
		requested?: number;
	};
};

type ApiOffer = {
	attributes?: {
		price?: ApiOfferPrice;
	};
};

type ApiOrderProduct = {
	attributes: {
		title: string;
		brand?: string;
		ean: string;
		slug?: string;
		offers?: Record<string, Record<string, ApiOffer>>;
	};
	links?: {
		self?: string;
	};
};

type ApiProductCategory = {
	name: string;
	products: ApiOrderProduct[];
};

type ApiOrderAttributes = {
	orderNumber: string;
	date: string; // "YYYY-MM-DD HH:MM:SS"
	totalAmount: number;
	orderStatus: string;
	slot?: { dateBegin: string; dateEnd: string } | null;
	isPaidOnSite?: boolean;
	productList?: {
		categories: ApiProductCategory[];
	};
};

type ApiOrderResponse = {
	attributes: ApiOrderAttributes;
	links?: {
		orderDetailsPage?: string;
		getStatement?: string | null;
		refundPage?: string;
	};
};

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
	category?: string;
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

// ─── API mapping ───────────────────────────────────────────────────────────────

function formatApiTimeSlot(
	slot: { dateBegin: string; dateEnd: string } | null | undefined,
): string | undefined {
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

function extractOrderDetailsFromApi(
	apiOrder: ApiOrderResponse,
	orderDetailsPageUrl: string,
): OrderDetails {
	const orderNumber = apiOrder.attributes.orderNumber;
	const orderedAt = apiOrder.attributes.date.slice(0, 10); // Extract YYYY-MM-DD
	const total = apiOrder.attributes.totalAmount;
	const deliverySlot = formatApiTimeSlot(apiOrder.attributes.slot);

	// Extract products from all categories
	const products: OrderProduct[] = [];
	const productList = apiOrder.attributes.productList;

	if (productList?.categories) {
		for (const category of productList.categories) {
			const categoryName = category.name || undefined;
			for (const apiProduct of category.products) {
				const offerData = apiProduct.attributes.offers;
				let unitPrice: number | undefined;
				let totalPrice: number | undefined;

				// Extract price from first available offer
				if (offerData) {
					for (const eanOffers of Object.values(offerData)) {
						for (const offer of Object.values(eanOffers)) {
							const price = offer.attributes?.price;
							if (price?.totalPrice?.delivered) {
								totalPrice = price.totalPrice.delivered;
							}
							if (price?.price) {
								unitPrice = price.price;
							}
							if (unitPrice || totalPrice) break;
						}
						if (unitPrice || totalPrice) break;
					}
				}

				const productUrl = apiProduct.attributes.slug
					? normalizeUrl(
							`/p/${apiProduct.attributes.slug}-${apiProduct.attributes.ean}`,
						)
					: undefined;

				products.push({
					name: apiProduct.attributes.title,
					productId: apiProduct.attributes.ean,
					category: categoryName,
					unavailable: false,
					packaging: undefined,
					totalPrice,
					unitPrice,
					currency: totalPrice || unitPrice ? "EUR" : undefined,
					url: productUrl,
				});
			}
		}
	}

	// Sort products by productId (numeric)
	products.sort((a, b) => {
		const aId = Number.parseInt(a.productId ?? "0", 10);
		const bId = Number.parseInt(b.productId ?? "0", 10);
		return aId - bId;
	});

	return {
		id: orderNumber,
		url: orderDetailsPageUrl,
		orderedAt,
		billed: apiOrder.attributes.isPaidOnSite === false ? true : undefined,
		deliverySlot,
		total,
		currency: total !== undefined ? "EUR" : undefined,
		invoiceUrl: normalizeUrl(apiOrder.links?.getStatement ?? undefined),
		refundUrl: normalizeUrl(apiOrder.links?.refundPage),
		products,
	};
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

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

// ─── API fetching (uses Playwright request context for browser TLS fingerprint) ─

async function fetchOrderDetailsFromApi(
	apiContext: import("playwright").APIRequestContext,
	orderNumber: string,
): Promise<{ orderDetails: OrderDetails; orderDetailsPageUrl: string }> {
	const url = `${ORDERS_API_URL}/${orderNumber}`;
	const response = await apiContext.get(url, {
		headers: {
			Accept: "application/json",
			Referer: "https://www.carrefour.fr/mon-compte/mes-achats/en-ligne",
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

	const apiOrder = (await response.json()) as ApiOrderResponse;
	const orderDetailsPageUrl = resolveOrderDetailsUrl(orderNumber);
	const orderDetails = extractOrderDetailsFromApi(
		apiOrder,
		orderDetailsPageUrl,
	);

	return { orderDetails, orderDetailsPageUrl };
}

async function fetchOrderDetailsFromAuthState(
	orderNumber: string,
): Promise<OrderDetails> {
	const storageState = await readAuthState();
	const apiContext = await playwrightRequest.newContext({
		storageState,
		baseURL: "https://www.carrefour.fr",
	});
	try {
		const { orderDetails } = await fetchOrderDetailsFromApi(
			apiContext,
			orderNumber,
		);
		return orderDetails;
	} finally {
		await apiContext.dispose();
	}
}

async function fetchOrderDetailsFromCdp(
	cdpUrl: string,
	orderNumber: string,
): Promise<OrderDetails> {
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
		const { orderDetails } = await fetchOrderDetailsFromApi(
			apiContext,
			orderNumber,
		);
		return orderDetails;
	} finally {
		await browser.close().catch(() => undefined);
	}
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

// ─── Public API ────────────────────────────────────────────────────────────────

export async function getCarrefourOrderDetails(
	orderRef: string,
	cdpUrl?: string,
): Promise<OrderDetails> {
	// Extract order number from orderRef (URL or numeric ID)
	const normalized = orderRef.trim();

	let orderNumber: string;
	if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
		const idMatch = normalized.match(/\/(\d{6,})(?:\?|$)/);
		if (!idMatch) {
			throw new Error(
				"Unable to extract order ID from URL. Expected format: .../order-id or numeric ID at least 6 digits.",
			);
		}
		orderNumber = idMatch[1];
	} else if (/^\d{6,}$/.test(normalized)) {
		orderNumber = normalized;
	} else {
		throw new Error(
			"orderRef must be an absolute URL or a numeric order id (at least 6 digits)",
		);
	}

	return cdpUrl
		? await fetchOrderDetailsFromCdp(cdpUrl, orderNumber)
		: await fetchOrderDetailsFromAuthState(orderNumber);
}

export const __testing = {
	extractOrderDetailsFromApi,
	extractOrderDetailsFromHtml,
	normalizeDateToIso,
	parseBilledFlag,
	parseDeliverySlot,
	parseUnavailableProductsCount,
	parseProductsFromHtml,
	resolveOrderDetailsUrl,
};
