# carrefour-mcp

carrefour-mcp lets you search products on Carrefour France and get structured results.

## Features

- MCP tool available: search_products
- CLI command available: carrefour-mcp search_products
- Supported server modes: stdio, http, or both

## Prerequisites

- Node.js 20+
- pnpm 10+

## Installation

Install dependencies:

```bash
pnpm install
```

Install browser runtime:

```bash
pnpm install:browsers
```

## Start The MCP Server

Development mode:

```bash
MCP_TRANSPORT=stdio pnpm dev
MCP_TRANSPORT=http pnpm dev
MCP_TRANSPORT=both pnpm dev
```

Use a custom HTTP port:

```bash
MCP_TRANSPORT=http PORT=4000 pnpm dev
```

Production mode:

```bash
pnpm build
MCP_TRANSPORT=http pnpm start
```

## Use The CLI

Run directly from source (no rebuild required):

```bash
pnpm cli -- search_products "jus de carottes"
pnpm cli -- search_products "jus de carottes" --limit 5
```

Use the installed binary command:

```bash
pnpm build
pnpm link --global
carrefour-mcp search_products "jus de carottes"
carrefour-mcp search_products "jus de carottes" --limit 5
```

Output format:

- Raw JSON on stdout

## HTTP Endpoints

- POST /mcp
- GET /health

Default local MCP URL:

- <http://127.0.0.1:3000/mcp>

## Cache Configuration

You can configure search caching with environment variables:

- CARREFOUR_SEARCH_CACHE_ENABLED (default: true)
- CARREFOUR_SEARCH_CACHE_DIR (default: .cache/carrefour-mcp)
- CARREFOUR_SEARCH_CACHE_TTL_MS (default: 900000)
