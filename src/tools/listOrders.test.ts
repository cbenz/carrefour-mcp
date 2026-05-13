import { expect, test } from "vitest";

import { __testing } from "./listOrders.js";

test("extractOrdersFromHtml extracts order summaries", () => {
  const html = `
    <main>
      <ul>
        <li>
          <div>
            <div>28/04/26</div>
            <div>
              <a href="/mon-compte/mes-achats/en-ligne/649654675">Carrefour Livraison</a>
              <p>N° 649654675</p>
              <div>Livraison Dim. 3 Mai 09h00 - 11h00</div>
              <div>3 Allee Hoche, 92240 Malakoff</div>
            </div>
            <div>
              <p>176,07€</p>
              <a href="/mon-compte/mes-achats/en-ligne/649654675">Voir le détail</a>
            </div>
            <div>
              <span>Facturée</span>
              <a href="/mon-compte/mes-achats/en-ligne/commander/649654675">Commander à nouveau</a>
              <a href="/mon-compte/mes-achats/facture/649654675?invoiceType=Invoice">Télécharger ma facture</a>
            </div>
          </div>
        </li>
        <li>
          <div>
            <div>08/04/26</div>
            <div>
              <a href="/mon-compte/mes-achats/en-ligne/643633662">Carrefour Livraison</a>
              <p>N° 643633662</p>
              <div>Livraison Jeu. 9 Avr. 13h00 - 15h00</div>
              <div>3 Allee Hoche, 92240 Malakoff</div>
            </div>
            <div>
              <p>161,53€</p>
              <a href="/mon-compte/mes-achats/en-ligne/643633662">Voir le détail</a>
            </div>
            <div>
              <span>Facturée</span>
              <a href="/mon-compte/mes-achats/en-ligne/commander/643633662">Commander à nouveau</a>
              <a href="/mon-compte/mes-achats/facture/643633662?invoiceType=Invoice">Télécharger ma facture</a>
            </div>
          </div>
        </li>
      </ul>
    </main>
  `;

  const orders = __testing.extractOrdersFromHtml(html);

  expect(orders).toEqual([
    {
      id: "649654675",
      date: "2026-04-28",
      total: 176.07,
      currency: "EUR",
      status: undefined,
      timeSlot: "09h00 - 11h00",
      billed: true,
      detailUrl:
        "https://www.carrefour.fr/mon-compte/mes-achats/en-ligne/commander/649654675",
    },
    {
      id: "643633662",
      date: "2026-04-08",
      total: 161.53,
      currency: "EUR",
      status: undefined,
      timeSlot: "13h00 - 15h00",
      billed: true,
      detailUrl:
        "https://www.carrefour.fr/mon-compte/mes-achats/en-ligne/commander/643633662",
    },
  ]);
});

test("isCloudflareChallengeHtml detects challenge pages", () => {
  const html = `
    <html>
      <head><title>Un instant...</title></head>
      <body>
        <p>C’est une formalité… si vous êtes un humain !</p>
        <p>Vérifions ensemble que vous n’êtes pas un robot.</p>
        <p>Ray ID : 123456</p>
      </body>
    </html>
  `;

  expect(__testing.isCloudflareChallengeHtml(html)).toBe(true);
});

test("hasNoOrdersMarker detects empty order history message", () => {
  const html =
    "<main><h1>Mes commandes</h1><p>Vous n'avez pas encore de commande</p></main>";
  expect(__testing.hasNoOrdersMarker(html)).toBe(true);
});

test("extractOrdersFromDashboardText parses mon-compte summary section", () => {
  const html = `
    <main>
      <h2>Mes achats</h2>
      <h3>Commandes en ligne</h3>
      <div>
        <span>28/04/2026</span>
        <span>- Carrefour Livraison</span>
        <span>176,07</span>
        <span>€</span>
      </div>
      <div>
        <span>08/04/2026</span>
        <span>- Carrefour Livraison</span>
        <span>161,53</span>
        <span>€</span>
      </div>
      <a href="#">Voir toutes mes commandes</a>
      <h3>Tickets de caisse en magasin</h3>
    </main>
  `;

  expect(__testing.extractOrdersFromDashboardText(html)).toEqual([
    {
      date: "2026-04-28",
      total: 176.07,
      currency: "EUR",
      status: "Carrefour Livraison",
    },
    {
      date: "2026-04-08",
      total: 161.53,
      currency: "EUR",
      status: "Carrefour Livraison",
    },
  ]);
});

test("parseOrderTimeSlot and parseBilledFlag parse expected values", () => {
  expect(
    __testing.parseOrderTimeSlot("Livraison Dim. 3 Mai 09h00 - 11h00"),
  ).toBe("09h00 - 11h00");
  expect(__testing.parseBilledFlag("Facturée")).toBe(true);
});

test("extractOrdersFromApiResponse maps API data to OrderSummary", () => {
  const apiData = [
    {
      attributes: {
        orderNumber: "649654675",
        date: "2026-04-28 19:53:01",
        totalAmount: 176.07,
        orderStatus: "RECEPTIONNEE",
        serviceType: "HOME_DELIVERY",
        slot: {
          dateBegin: "2026-05-03 09:00:01",
          dateEnd: "2026-05-03 11:00:01",
        },
        isPaidOnSite: false,
        paymentInfos: [
          { amount: 177.99, date: "2026-04-28T19:53:01+02:00", choice: "VISA" },
        ],
      },
      links: {
        orderDetailsPage: "/mon-compte/mes-achats/en-ligne/649654675",
        getStatement: "/mon-compte/mes-achats/facture/649654675",
      },
    },
    {
      attributes: {
        orderNumber: "643633662",
        date: "2026-04-08 13:24:51",
        totalAmount: 161.53,
        orderStatus: "RECEPTIONNEE",
        serviceType: "HOME_DELIVERY",
        slot: {
          dateBegin: "2026-04-09 13:00:01",
          dateEnd: "2026-04-09 15:00:01",
        },
        isPaidOnSite: false,
        paymentInfos: [
          { amount: 161.53, date: "2026-04-08T13:24:51+02:00", choice: "VISA" },
        ],
      },
      links: {
        orderDetailsPage: "/mon-compte/mes-achats/en-ligne/643633662",
        getStatement: "/mon-compte/mes-achats/facture/643633662",
      },
    },
    {
      attributes: {
        orderNumber: "612345678",
        date: "2025-12-15 10:05:00",
        totalAmount: 89.9,
        orderStatus: "EN_PREPARATION",
        serviceType: "HOME_DELIVERY",
        slot: null,
        isPaidOnSite: false,
        paymentInfos: [],
      },
      links: {
        orderDetailsPage: "/mon-compte/mes-achats/en-ligne/612345678",
        getStatement: null,
      },
    },
  ];

  expect(__testing.extractOrdersFromApiResponse(apiData)).toEqual([
    {
      id: "649654675",
      date: "2026-04-28",
      total: 176.07,
      currency: "EUR",
      status: "RECEPTIONNEE",
      timeSlot: "09h00 - 11h00",
      billed: true,
      detailUrl:
        "https://www.carrefour.fr/mon-compte/mes-achats/en-ligne/649654675",
    },
    {
      id: "643633662",
      date: "2026-04-08",
      total: 161.53,
      currency: "EUR",
      status: "RECEPTIONNEE",
      timeSlot: "13h00 - 15h00",
      billed: true,
      detailUrl:
        "https://www.carrefour.fr/mon-compte/mes-achats/en-ligne/643633662",
    },
    {
      id: "612345678",
      date: "2025-12-15",
      total: 89.9,
      currency: "EUR",
      status: "EN_PREPARATION",
      timeSlot: undefined,
      billed: undefined,
      detailUrl:
        "https://www.carrefour.fr/mon-compte/mes-achats/en-ligne/612345678",
    },
  ]);
});

test("sortOrdersByDateDesc sorts newest first and places undated orders last", () => {
  const sorted = __testing.sortOrdersByDateDesc([
    { id: "3", date: "2025-01-10" },
    { id: "1", date: "2026-04-28" },
    { id: "4" },
    { id: "2", date: "2026-01-01" },
  ]);

  expect(sorted).toEqual([
    { id: "1", date: "2026-04-28" },
    { id: "2", date: "2026-01-01" },
    { id: "3", date: "2025-01-10" },
    { id: "4" },
  ]);
});
