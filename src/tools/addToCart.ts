import type { Page } from "playwright";
import {
	buildAuthConfigFromEnv,
	createCarrefourContext,
} from "../auth/session.js";
import { getSharedBrowser } from "../playwright.js";

const CART_URL = "https://www.carrefour.fr/cart/driveclcv";

export type CartItem = {
	name: string;
	productId?: string;
	productUrl: string;
	quantity?: number;
};

export type CartItemResult = {
	name: string;
	productUrl: string;
	success: boolean;
	alreadyInCart?: boolean;
	message?: string;
};

export type AddToCartResult = {
	added: number;
	alreadyInCart: number;
	failed: number;
	cartUrl: string;
	results: CartItemResult[];
};

async function addItemToCart(
	page: Page,
	item: CartItem,
): Promise<CartItemResult> {
	try {
		await page.goto(item.productUrl, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});

		await page
			.waitForLoadState("networkidle", { timeout: 7_000 })
			.catch(() => undefined);

		// Try to find the add-to-cart button (multiple selectors for robustness)
		const addToCartButton = page
			.locator(
				[
					"button[data-testid='add-to-cart']",
					"button[data-testid='add-to-cart-btn']",
					"button.product-add-to-cart",
					"button[class*='addToCart']",
					"button[class*='add-to-cart']",
				].join(", "),
			)
			.first();

		const buttonVisible = await addToCartButton.isVisible().catch(() => false);

		if (!buttonVisible) {
			// Fall back to text-based search
			const textButton = page
				.getByRole("button", { name: /ajouter au panier/i })
				.first();
			const textButtonVisible = await textButton.isVisible().catch(() => false);

			if (!textButtonVisible) {
				// Button not found: the product is most likely already in the cart
				// (Carrefour replaces the add-to-cart button with a quantity stepper).
				return {
					name: item.name,
					productUrl: item.productUrl,
					success: true,
					alreadyInCart: true,
					message: "Already in cart.",
				};
			}

			await textButton.click();
		} else {
			await addToCartButton.click();
		}

		// Set quantity if > 1
		const qty = item.quantity ?? 1;
		if (qty > 1) {
			// Try to find quantity increment button
			const incrementButton = page
				.locator(
					"button[data-testid='increment-qty'], button[aria-label*='augmenter'], button[class*='increment']",
				)
				.first();
			const incrementVisible = await incrementButton
				.isVisible()
				.catch(() => false);
			if (incrementVisible) {
				for (let i = 1; i < qty; i++) {
					await incrementButton.click();
					await page.waitForTimeout(300);
				}
			}
		}

		return {
			name: item.name,
			productUrl: item.productUrl,
			success: true,
			message: "Added to cart.",
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			name: item.name,
			productUrl: item.productUrl,
			success: false,
			message: `Failed: ${message}`,
		};
	}
}

export async function addToCarrefourCart(
	items: CartItem[],
): Promise<AddToCartResult> {
	const config = buildAuthConfigFromEnv();
	if (!config.enabled) {
		throw new Error(
			"Authentication is disabled by CARREFOUR_AUTH_ENABLED. Enable it to add items to cart.",
		);
	}

	const validItems = items.filter((item) => Boolean(item.productUrl));
	if (validItems.length === 0) {
		throw new Error("No items with a product URL provided.");
	}

	const browser = await getSharedBrowser();
	const context = await createCarrefourContext(browser, {
		useAuth: true,
		requireAuth: true,
	});

	const results: CartItemResult[] = [];

	try {
		const page = await context.newPage();

		for (const item of validItems) {
			const result = await addItemToCart(page, item);
			results.push(result);
		}

		await page.close().catch(() => undefined);
	} finally {
		await context.close().catch(() => undefined);
	}

	const added = results.filter((r) => r.success && !r.alreadyInCart).length;
	const alreadyInCart = results.filter((r) => r.alreadyInCart).length;
	const failed = results.filter((r) => !r.success).length;

	return {
		added,
		alreadyInCart,
		failed,
		cartUrl: CART_URL,
		results,
	};
}
