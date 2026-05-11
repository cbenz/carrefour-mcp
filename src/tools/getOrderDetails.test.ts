import { expect, test } from "vitest";

import { __testing } from "./getOrderDetails.js";

test("extractOrderDetailsFromHtml parses order details page", () => {
  const html = `
    <main>
      <h1>Ma commande N° 649654675</h1>
      <section>
        <p>Sur Carrefour.fr le 28/04/26</p>
        <p>Facturée</p>
      </section>
      <section>
        <h2>Adresse de livraison</h2>
        <p>Livraison à domicile</p>
        <p>3 Allee Hoche, 92240 Malakoff</p>
        <p>Livraison estimée Dim. 3 Mai 09h00 - 11h00</p>
      </section>
      <section>
        <h2>Détail de la commande</h2>
        <p>Total 176,07€</p>
      </section>
      <section>
        <h2>Conserves et bocaux</h2>
      </section>
      <ul>
        <li>
          <div class="order-product-card">
            <a href="/p/tomates-concassees-carrefour-1234567890123" class="order-product-container">
              <p class="order-product-container__brand">CARREFOUR</p>
              <p class="order-product-container__title">Tomates concassées Carrefour</p>
              <div class="order-product-container__packaging">la boite de 400g</div>
              <div class="order-product-container__quantity">x2</div>
              <div class="order-product-container__price">2,40€</div>
            </a>
          </div>
        </li>
        <li>
          <div class="order-product-card">
            <a href="/p/thon-entier-nature-3245678901234" class="order-product-container">
              <p class="order-product-container__title">Thon entier nature</p>
              <div class="order-product-container__quantity order-product-container__quantity--crossed">x1</div>
              <div class="order-product-container__price product-price--crossed-out">3,80€</div>
            </a>
            <div class="order-product-card-quantity-change__label">Non livré, non facturé</div>
          </div>
        </li>
      </ul>
      <section>
        <p>1 produits indisponibles</p>
      </section>
      <a href="/mon-compte/mes-achats/en-ligne/commander/649654675">Commander à nouveau</a>
      <a href="/mon-compte/mes-achats/remboursement/649654675">Demander un remboursement</a>
      <a href="/mon-compte/mes-achats/facture/649654675?invoiceType=Invoice">Télécharger ma facture</a>
    </main>
  `;

  const details = __testing.extractOrderDetailsFromHtml(
    html,
    "https://www.carrefour.fr/mon-compte/mes-achats/en-ligne/649654675",
  );

  expect(details).toEqual({
    id: "649654675",
    url: "https://www.carrefour.fr/mon-compte/mes-achats/en-ligne/649654675",
    orderedAt: "2026-04-28",
    billed: true,
    deliveryType: "Livraison à domicile",
    deliveryAddress: "3 Allee Hoche, 92240 Malakoff",
    deliverySlot: "09h00 - 11h00",
    total: 176.07,
    currency: "EUR",
    invoiceUrl:
      "https://www.carrefour.fr/mon-compte/mes-achats/facture/649654675?invoiceType=Invoice",
    reorderUrl:
      "https://www.carrefour.fr/mon-compte/mes-achats/en-ligne/commander/649654675",
    refundUrl:
      "https://www.carrefour.fr/mon-compte/mes-achats/remboursement/649654675",
    unavailableProductsCount: 1,
    products: [
      {
        name: "Tomates concassées Carrefour",
        productId: "1234567890123",
        unavailable: false,
        quantity: 2,
        packaging: "la boite de 400g",
        totalPrice: 2.4,
        unitPrice: undefined,
        currency: "EUR",
        url: "https://www.carrefour.fr/p/tomates-concassees-carrefour-1234567890123",
      },
      {
        name: "Thon entier nature",
        productId: "3245678901234",
        unavailable: true,
        quantity: 1,
        packaging: undefined,
        totalPrice: 3.8,
        unitPrice: undefined,
        currency: "EUR",
        url: "https://www.carrefour.fr/p/thon-entier-nature-3245678901234",
      },
    ],
  });
});

test("resolveOrderDetailsUrl accepts id and absolute url", () => {
  expect(__testing.resolveOrderDetailsUrl("649654675")).toBe(
    "https://www.carrefour.fr/mon-compte/mes-achats/en-ligne/649654675",
  );

  expect(
    __testing.resolveOrderDetailsUrl(
      "https://www.carrefour.fr/mon-compte/mes-achats/en-ligne/649654675",
    ),
  ).toBe("https://www.carrefour.fr/mon-compte/mes-achats/en-ligne/649654675");
});

test("normalizeDateToIso converts french formats", () => {
  expect(__testing.normalizeDateToIso("28/04/26")).toBe("2026-04-28");
  expect(__testing.normalizeDateToIso("08/04/2026")).toBe("2026-04-08");
});
