#!/usr/bin/env node

import { Command, CommanderError, InvalidArgumentError } from "commander";
import {
  captureCarrefourAuthFromCdp,
  getCarrefourAuthStatus,
  loginCarrefourAuth,
  logoutCarrefourAuth,
} from "./tools/auth.js";
import {
  closeProductBrowser,
  getCarrefourProduct,
} from "./tools/getProductDetails.js";
import { getCarrefourOrderDetails } from "./tools/getOrderDetails.js";
import { listCarrefourOrders } from "./tools/listOrders.js";
import {
  closeBrowser,
  searchCarrefourProducts,
} from "./tools/searchProducts.js";

function parseLimit(value: string): number {
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 1 || parsedValue > 30) {
    throw new InvalidArgumentError(
      "--limit must be an integer between 1 and 30",
    );
  }

  return parsedValue;
}

function parseOrderLimit(value: string): number {
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 1 || parsedValue > 100) {
    throw new InvalidArgumentError(
      "--limit must be an integer between 1 and 100",
    );
  }

  return parsedValue;
}

function parseTimeoutMs(value: string): number {
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 10_000) {
    throw new InvalidArgumentError(
      "--timeout-ms must be an integer greater than or equal to 10000",
    );
  }

  return parsedValue;
}

const program = new Command();

program
  .name("carrefour-mcp")
  .description("CLI launcher for Carrefour MCP tools")
  .showHelpAfterError()
  .addHelpText(
    "after",
    [
      "",
      "Examples:",
      '  carrefour-mcp search_products "jus de carottes"',
      '  carrefour-mcp search_products "jus de carottes" --limit 5',
      '  carrefour-mcp get_product_details "3608580823445"',
      '  carrefour-mcp get_product_details "https://www.carrefour.fr/p/jus-de-carotte-pur-jus-carrefour-extra-3560070583379"',
    ].join("\n"),
  );

program
  .command("auth_login")
  .description(
    "Open a visible browser for manual Carrefour login and persist session state",
  )
  .option(
    "--timeout-ms <number>",
    "Login timeout in milliseconds",
    parseTimeoutMs,
  )
  .action(async (options: { timeoutMs?: number }): Promise<void> => {
    const result = await loginCarrefourAuth(options.timeoutMs);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

program
  .command("auth_capture_cdp")
  .description(
    "Capture auth session from an already authenticated Chrome/Chromium started with remote debugging",
  )
  .option(
    "--cdp-url <url>",
    "CDP endpoint URL (default: http://127.0.0.1:9222)",
  )
  .action(async (options: { cdpUrl?: string }): Promise<void> => {
    const result = await captureCarrefourAuthFromCdp(options.cdpUrl);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

program
  .command("auth_status")
  .description("Check whether stored Carrefour authentication is valid")
  .action(async (): Promise<void> => {
    const result = await getCarrefourAuthStatus();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

program
  .command("auth_logout")
  .description("Delete locally stored Carrefour authentication state")
  .action(async (): Promise<void> => {
    const result = await logoutCarrefourAuth();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

program
  .command("list_orders")
  .description("List Carrefour orders from the authenticated account")
  .option(
    "--limit <number>",
    "Maximum number of orders to return",
    parseOrderLimit,
    20,
  )
  .option(
    "--cdp-url <url>",
    "CDP endpoint URL for an already authenticated browser (default: http://127.0.0.1:9222)",
  )
  .action(
    async (options: { limit: number; cdpUrl?: string }): Promise<void> => {
      const result = await listCarrefourOrders(options.limit, options.cdpUrl);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    },
  );

program
  .command("get_order_details")
  .description("Fetch Carrefour order details and print the raw JSON payload")
  .argument(
    "<orderRef>",
    "Order reference: numeric order id or absolute Carrefour order details URL",
  )
  .option(
    "--cdp-url <url>",
    "CDP endpoint URL for an already authenticated browser",
  )
  .action(async (orderRef: string, options: { cdpUrl?: string }): Promise<void> => {
    const result = await getCarrefourOrderDetails(orderRef, options.cdpUrl);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

program
  .command("search_products")
  .description("Run a Carrefour product search and print the raw JSON payload")
  .argument("<query...>", "Product search query")
  .option(
    "--limit <number>",
    "Maximum number of products to return",
    parseLimit,
    10,
  )
  .action(
    async (queryParts: string[], options: { limit: number }): Promise<void> => {
      const query = queryParts.join(" ").trim();
      const result = await searchCarrefourProducts(query, options.limit);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    },
  );

program
  .command("get_product_details")
  .description("Fetch a Carrefour product page and print the raw JSON payload")
  .argument(
    "<productRef>",
    "Product reference: numeric product id or absolute Carrefour product URL",
  )
  .action(async (productRef: string): Promise<void> => {
    const result = await getCarrefourProduct(productRef);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

program.exitOverride();

let exitCode = 0;
try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    exitCode = error.exitCode;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    exitCode = 1;
  }
} finally {
  await closeBrowser().catch(() => undefined);
  await closeProductBrowser().catch(() => undefined);
}

if (exitCode !== 0) {
  process.exit(exitCode);
}
