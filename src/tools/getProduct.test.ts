import { expect, test } from "vitest";

import { __testing } from "./getProduct.js";

test("extractProductDetailsFromHtml extracts key product data", () => {
  const html = `
    <html>
      <head>
        <link rel="canonical" href="https://www.carrefour.fr/p/jus-de-carotte-pur-jus-carrefour-extra-3560070583379" />
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Jus de Carotte Pur Jus CARREFOUR EXTRA",
            "brand": { "@type": "Brand", "name": "CARREFOUR EXTRA" },
            "url": "https://www.carrefour.fr/p/jus-de-carotte-pur-jus-carrefour-extra-3560070583379",
            "image": [
              "https://media.carrefour.fr/medias/abc/p_200x200/3560070583379_0.JPG"
            ],
            "offers": {
              "@type": "Offer",
              "price": "2.29",
              "priceCurrency": "EUR"
            }
          }
        </script>
      </head>
      <body>
        <main>
          <h1>Jus de Carotte Pur Jus CARREFOUR EXTRA</h1>
          <button>1L</button>
          <div>
            <button aria-label="Nutri-Score: B">
              <img alt="Nutri-Score: B" src="/medias/nutri-score-b.png" />
            </button>
          </div>
          <section>
            <p>Ingrédients (dont ALLERGÈNES)</p>
            <div>Jus de carotte, acidifiant : jus de citron.</div>
          </section>
          <section>
            <p>Description</p>
            <div>Délicieux jus de carotte à servir frais.</div>
          </section>
          <section>
            <p>Valeurs nutritionnelles</p>
            <div>Valeur énergétique (kJ) 94 kJ / 100</div>
            <div>Valeur énergétique (kcal) 22 kcal / 100</div>
            <div>Glucides 5.1 g / 100</div>
          </section>
          <div>
            <p>2,29 €</p>
            <p>2,29 € / L</p>
          </div>
          <img src="/medias/540x540/f4/7f/product-jus-carottes-bio.jpg" alt="Jus de Carotte Pur Jus CARREFOUR EXTRA" />
        </main>
      </body>
    </html>
  `;

  const result = __testing.extractProductDetailsFromHtml(
    html,
    "https://www.carrefour.fr/p/fallback-url",
  );

  expect(result).toMatchObject({
    source: "carrefour.fr",
    name: "Jus de Carotte Pur Jus CARREFOUR EXTRA",
    url: "https://www.carrefour.fr/p/jus-de-carotte-pur-jus-carrefour-extra-3560070583379",
    brand: "CARREFOUR EXTRA",
    quantity: "1L",
    price: 2.29,
    currency: "EUR",
    nutriScore: "B",
    ingredients: "Jus de carotte, acidifiant : jus de citron.",
    description: "Délicieux jus de carotte à servir frais.",
  });

  expect(result.unitPrice).toEqual({
    value: 2.29,
    unit: "l",
    raw: "2,29 € / L",
  });

  expect(result.nutritionFacts).toEqual([
    {
      label: "Valeur énergétique (kJ)",
      value: "94 kJ / 100",
    },
    {
      label: "Valeur énergétique (kcal)",
      value: "22 kcal / 100",
    },
    {
      label: "Glucides",
      value: "5.1 g / 100",
    },
  ]);

  expect(result.images).toContain(
    "https://www.carrefour.fr/medias/540x540/f4/7f/product-jus-carottes-bio.jpg",
  );
});

test("extractUnitPrice supports 100ml and kg formats", () => {
  expect(__testing.extractUnitPrice("2 ,29 € / L")).toEqual({
    value: 2.29,
    unit: "l",
    raw: "2 ,29 € / L",
  });

  expect(__testing.extractUnitPrice("3,50 € / 100ml")).toEqual({
    value: 3.5,
    unit: "100ml",
    raw: "3,50 € / 100ml",
  });

  expect(__testing.extractUnitPrice("12,99 € / kg")).toEqual({
    value: 12.99,
    unit: "kg",
    raw: "12,99 € / kg",
  });
});

test("computeUnitPriceFromPriceAndQuantity infers €/L and €/kg", () => {
  expect(__testing.computeUnitPriceFromPriceAndQuantity(2.29, "1L")).toEqual({
    value: 2.29,
    unit: "l",
    raw: "2,29 € / 1L",
  });

  expect(
    __testing.computeUnitPriceFromPriceAndQuantity(2.29, "500ml"),
  ).toEqual({
    value: 4.58,
    unit: "l",
    raw: "2,29 € / 500ml",
  });

  expect(__testing.computeUnitPriceFromPriceAndQuantity(3.5, "250g")).toEqual({
    value: 14,
    unit: "kg",
    raw: "3,50 € / 250g",
  });
});
