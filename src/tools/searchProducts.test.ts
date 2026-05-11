import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import { __testing } from "./searchProducts.js";

test("parsePriceText parses euro formatted decimals", () => {
  expect(__testing.parsePriceText("1,99 €")).toBe(1.99);
  expect(__testing.parsePriceText("2 €")).toBe(2);
  expect(__testing.parsePriceText("not a price")).toBeUndefined();
});

test("extractProductsFromRenderedHtml parses DOM product cards", () => {
  const html = `
    <main id="search-results">
      <section aria-label="Résultats de recherche">
        <article data-testid="product-card">
          <div class="product-card__media">
            <img src="/images/cards/placeholder.svg" alt="placeholder" />
            <img src="/medias/540x540/f4/7f/product-jus-carottes-bio.jpg" alt="Jus de carottes bio" />
          </div>
          <div class="product-card__content">
            <span class="badge">Bio</span>
            <h3>Jus de carottes bio</h3>
            <a href="/p/jus-carottes-bio-123" aria-label="Voir la fiche produit">Voir</a>
            <div class="pricing-block">
              <span>Prix au litre: 6,90 € / L</span>
              <p>3,45 €</p>
            </div>
          </div>
        </article>
        <article data-testid="product-card">
          <div class="product-card__content">
            <h3>Article sans lien</h3>
            <p>2,00 €</p>
          </div>
        </article>
      </section>
    </main>
  `;

  const products = __testing.extractProductsFromRenderedHtml(html);

  expect(products).toEqual([
    {
      name: "Jus de carottes bio",
      url: "https://www.carrefour.fr/p/jus-carottes-bio-123",
      id: "123",
      price: 3.45,
      currency: "EUR",
      image:
        "https://www.carrefour.fr/medias/540x540/f4/7f/product-jus-carottes-bio.jpg",
    },
  ]);
});

test("dedupeProducts keeps first product per url", () => {
  const products = __testing.dedupeProducts([
    { name: "A", url: "https://www.carrefour.fr/p/1", price: 1 },
    { name: "A bis", url: "https://www.carrefour.fr/p/1", price: 2 },
    { name: "B", url: "https://www.carrefour.fr/p/2", price: 3 },
  ]);

  expect(products).toEqual([
    { name: "A", url: "https://www.carrefour.fr/p/1", price: 1 },
    { name: "B", url: "https://www.carrefour.fr/p/2", price: 3 },
  ]);
});

test("loadSearchPageDataWithCache reuses cached response for same URL", async () => {
  const cacheDir = await mkdtemp(
    path.join(tmpdir(), "carrefour-mcp-cache-test-"),
  );
  let calls = 0;
  let now = 1_000;

  try {
    const loader = async () => {
      calls += 1;
      return {
        html: `
          <main>
            <article>
              <h3>Product ${calls}</h3>
              <a href="/p/mock-${calls}">Voir</a>
              <p>1,99 €</p>
            </article>
          </main>
        `,
        products: [
          { name: `Product ${calls}`, url: "https://www.carrefour.fr/p/1" },
        ],
      };
    };

    const config = {
      enabled: true,
      cacheDir,
      ttlMs: 60_000,
      now: () => now,
    };

    const first = await __testing.loadSearchPageDataWithCache(
      "https://www.carrefour.fr/s?q=jus",
      loader,
      config,
    );

    now += 5_000;

    const second = await __testing.loadSearchPageDataWithCache(
      "https://www.carrefour.fr/s?q=jus",
      loader,
      config,
    );

    expect(calls).toBe(1);
    expect(second).toEqual(first);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("loadSearchPageDataWithCache refreshes cache when TTL is expired", async () => {
  const cacheDir = await mkdtemp(
    path.join(tmpdir(), "carrefour-mcp-cache-ttl-test-"),
  );
  let calls = 0;
  let now = 10_000;

  try {
    const loader = async () => {
      calls += 1;
      return {
        html: `
          <main>
            <article>
              <h3>P${calls}</h3>
              <a href="/p/${calls}">Voir</a>
              <p>2,49 €</p>
            </article>
          </main>
        `,
        products: [
          { name: `P${calls}`, url: `https://www.carrefour.fr/p/${calls}` },
        ],
      };
    };

    const config = {
      enabled: true,
      cacheDir,
      ttlMs: 1_000,
      now: () => now,
    };

    const first = await __testing.loadSearchPageDataWithCache(
      "https://www.carrefour.fr/s?q=carotte",
      loader,
      config,
    );

    now += 2_000;

    const second = await __testing.loadSearchPageDataWithCache(
      "https://www.carrefour.fr/s?q=carotte",
      loader,
      config,
    );

    expect(calls).toBe(2);
    expect(second).not.toEqual(first);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("buildSearchCacheConfigFromEnv reads cache settings", () => {
  const config = __testing.buildSearchCacheConfigFromEnv({
    CARREFOUR_SEARCH_CACHE_ENABLED: "false",
    CARREFOUR_SEARCH_CACHE_DIR: "/tmp/carrefour-custom-cache",
    CARREFOUR_SEARCH_CACHE_TTL_MS: "5000",
  });

  expect(config.enabled).toBe(false);
  expect(config.cacheDir).toBe("/tmp/carrefour-custom-cache");
  expect(config.ttlMs).toBe(5000);
});
