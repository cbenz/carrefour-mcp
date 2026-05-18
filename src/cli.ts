#!/usr/bin/env node

import { Command, CommanderError, InvalidArgumentError } from "commander";
import {
  buildManualChromeRemoteCommandPlan,
  cleanupManualChromeProfileDir,
  captureCarrefourAuthState,
  getCarrefourAuthStatus,
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
import { setupPipeSafeStdout } from "./cliOutput.js";

setupPipeSafeStdout(process.stdout);

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
    "Print the SSH command to run Chromium remotely with remote debugging for manual Carrefour login",
  )
  .option(
    "--timeout-ms <number>",
    "Deprecated option kept for compatibility",
    parseTimeoutMs,
  )
  .option(
    "--cdp-url <url>",
    "CDP endpoint URL to use for the next auth_capture_state step (default: http://127.0.0.1:9222)",
  )
  .option(
    "--profile-dir <path>",
    "Manual Chrome user-data-dir for this login flow",
  )
  .option(
    "--chrome-bin <path>",
    "Chromium/Chrome binary to include in the suggested command (default: chromium)",
  )
  .option(
    "--ssh-target <target>",
    "SSH target used in the suggested command (default: coursicota@203.0.113.42)",
  )
  .action(
    async (options: {
      timeoutMs?: number;
      cdpUrl?: string;
      profileDir?: string;
      chromeBin?: string;
      sshTarget?: string;
    }): Promise<void> => {
      const plan = buildManualChromeRemoteCommandPlan({
        cdpUrl: options.cdpUrl,
        profileDir: options.profileDir,
        chromeBinary: options.chromeBin,
        sshTarget: options.sshTarget,
      });
      process.stdout.write(`${plan.command}\n`);
    },
  );

program
  .command("auth_capture_state")
  .description(
    "Capture auth session from an already authenticated Chrome/Chromium started with remote debugging",
  )
  .option(
    "--cdp-url <url>",
    "CDP endpoint URL (default: http://127.0.0.1:9222)",
  )
  .option(
    "--auth-state-path <path>",
    "Optional storageState destination path (fallback: CARREFOUR_AUTH_CAPTURE_STATE_PATH, then CARREFOUR_AUTH_STATE_PATH)",
  )
  .option(
    "--cleanup-profile",
    "Delete the manual Chrome profile directory after successful capture",
  )
  .option("--profile-dir <path>", "Manual Chrome profile directory to clean up")
  .action(
    async (options: {
      cdpUrl?: string;
      authStatePath?: string;
      cleanupProfile?: boolean;
      profileDir?: string;
    }): Promise<void> => {
      const result = await captureCarrefourAuthState(
        options.cdpUrl,
        options.authStatePath,
      );

      if (result.authenticated && options.cleanupProfile !== false) {
        const cleanup = await cleanupManualChromeProfileDir(
          options.profileDir,
          options.cdpUrl,
        );
        process.stdout.write(
          `${JSON.stringify({ ...result, cleanup }, null, 2)}\n`,
        );
        return;
      }

      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    },
  );

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
    "Maximum number of orders to return (omit to return all available orders)",
    parseOrderLimit,
  )
  .option(
    "--cdp-url <url>",
    "CDP endpoint URL for an already authenticated browser (default: http://127.0.0.1:9222)",
  )
  .option(
    "--start-date <date>",
    "Filter orders from this date (ISO 8601, e.g. 2024-01-01T00:00:00.000Z)",
  )
  .option(
    "--end-date <date>",
    "Filter orders up to this date (ISO 8601, e.g. 2026-12-31T00:00:00.000Z)",
  )
  .action(
    async (options: {
      limit?: number;
      cdpUrl?: string;
      startDate?: string;
      endDate?: string;
    }): Promise<void> => {
      const result = await listCarrefourOrders(
        options.limit,
        options.cdpUrl,
        options.startDate,
        options.endDate,
      );
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
  .action(
    async (orderRef: string, options: { cdpUrl?: string }): Promise<void> => {
      const result = await getCarrefourOrderDetails(orderRef, options.cdpUrl);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    },
  );

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
