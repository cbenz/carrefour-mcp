import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import {
  captureCarrefourAuthState,
  getCarrefourAuthStatus,
  importCarrefourAuthState,
  logoutCarrefourAuth,
} from "./tools/auth.js";
import { getCarrefourProduct } from "./tools/getProductDetails.js";
import { getCarrefourOrderDetails } from "./tools/getOrderDetails.js";
import { listCarrefourOrders } from "./tools/listOrders.js";
import { searchCarrefourProducts } from "./tools/searchProducts.js";

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "carrefour-mcp",
      version: "0.1.0",
    },
    {
      instructions:
        "This server provides Carrefour France product discovery tools. Use search_products to run a full-text product search and get_product_details to retrieve detailed data for a specific product URL or product ID.",
    },
  );

  server.registerTool(
    "auth_capture_state",
    {
      title: "Capture auth from existing browser",
      description:
        "Attach to an existing authenticated Chrome/Chromium session over CDP and save Carrefour auth state.",
      inputSchema: {
        cdpUrl: z
          .string()
          .url()
          .optional()
          .describe("CDP endpoint URL, for example http://127.0.0.1:9222"),
      },
    },
    async ({ cdpUrl }) => {
      try {
        const result = await captureCarrefourAuthState(cdpUrl);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `auth_capture_state failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "auth_import_state",
    {
      title: "Import Carrefour auth state",
      description:
        "Import a Playwright storageState payload and persist it as local Carrefour auth state. Optionally specify destinationPath to avoid overwriting the default location.",
      inputSchema: {
        storageState: z
          .object({
            cookies: z.array(z.record(z.string(), z.any())),
            origins: z.array(z.record(z.string(), z.any())),
          })
          .describe("Playwright storageState payload"),
        destinationPath: z
          .string()
          .optional()
          .describe(
            "Optional destination file path for the state (uses default if not provided)",
          ),
      },
    },
    async ({ storageState, destinationPath }) => {
      try {
        const result = await importCarrefourAuthState(
          storageState,
          destinationPath,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `auth_import_state failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "auth_status",
    {
      title: "Check Carrefour auth status",
      description:
        "Check whether an authenticated Carrefour browser session is available and still valid.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await getCarrefourAuthStatus();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `auth_status failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "auth_logout",
    {
      title: "Clear Carrefour auth session",
      description:
        "Delete the locally stored Carrefour authentication state file.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await logoutCarrefourAuth();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `auth_logout failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "list_orders",
    {
      title: "List Carrefour account orders",
      description:
        "List past Carrefour orders from the authenticated account history page.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe(
            "Maximum number of orders to return (if omitted, all available orders are returned)",
          ),
        cdpUrl: z
          .string()
          .url()
          .optional()
          .describe(
            "Optional CDP endpoint URL for an already authenticated browser",
          ),
        startDate: z
          .string()
          .optional()
          .describe(
            "Filter orders from this date (ISO 8601, e.g. 2024-01-01T00:00:00.000Z)",
          ),
        endDate: z
          .string()
          .optional()
          .describe(
            "Filter orders up to this date (ISO 8601, e.g. 2026-12-31T00:00:00.000Z)",
          ),
      },
    },
    async ({ limit, cdpUrl, startDate, endDate }) => {
      try {
        const result = await listCarrefourOrders(
          limit,
          cdpUrl,
          startDate,
          endDate,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `list_orders failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get_order_details",
    {
      title: "Get Carrefour order details",
      description:
        "Fetch a Carrefour order details page and return structured order fields such as amount, date, delivery slot, and invoice links.",
      inputSchema: {
        orderRef: z
          .string()
          .min(1)
          .describe(
            "Order reference: either a numeric order id or an absolute Carrefour order details URL",
          ),
        cdpUrl: z
          .string()
          .url()
          .optional()
          .describe(
            "Optional CDP endpoint URL for an already authenticated browser",
          ),
      },
    },
    async ({ orderRef, cdpUrl }) => {
      try {
        const result = await getCarrefourOrderDetails(orderRef, cdpUrl);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `get_order_details failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "search_products",
    {
      title: "Search Carrefour products",
      description:
        "Run a full-text search on carrefour.fr and return matching products with name, URL, and price when available.",
      inputSchema: {
        query: z.string().min(1).describe("Product search query"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(10)
          .describe("Maximum number of products to return"),
      },
    },
    async ({ query, limit }) => {
      try {
        const result = await searchCarrefourProducts(query, limit);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `search_products failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get_product_details",
    {
      title: "Get Carrefour product details",
      description:
        "Fetch a Carrefour product page and return structured details such as price, unit price, Nutri-Score, ingredients, and nutrition facts when available.",
      inputSchema: {
        url: z
          .string()
          .min(1)
          .describe(
            "Product reference: absolute Carrefour product URL or numeric product ID",
          ),
      },
    },
    async ({ url }) => {
      try {
        const result = await getCarrefourProduct(url);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text",
              text: `get_product_details failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}
