import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { getCarrefourProduct } from "./tools/getProduct.js";
import { searchCarrefourProducts } from "./tools/searchProducts.js";

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "carrefour-mcp",
      version: "0.1.0",
    },
    {
      instructions:
        "This server provides Carrefour France product discovery tools. Use search_products to run a full-text product search and get_product to retrieve detailed data for a specific product URL.",
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
    "get_product",
    {
      title: "Get Carrefour product details",
      description:
        "Fetch a Carrefour product page and return structured details such as price, unit price, Nutri-Score, ingredients, and nutrition facts when available.",
      inputSchema: {
        url: z.string().url().describe("Absolute Carrefour product URL"),
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
              text: `get_product failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}
