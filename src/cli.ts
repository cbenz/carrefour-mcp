#!/usr/bin/env node

import { Command, CommanderError, InvalidArgumentError } from "commander";
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
    ].join("\n"),
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
}

if (exitCode !== 0) {
  process.exit(exitCode);
}
