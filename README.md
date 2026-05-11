# carrefour-mcp

carrefour-mcp lets you search products on Carrefour France and get structured results.

## Features

- MCP tool available: search_products
- MCP tool available: get_product_details
- MCP tool available: auth_login
- MCP tool available: auth_capture_cdp
- MCP tool available: auth_status
- MCP tool available: auth_logout
- MCP tool available: list_orders
- MCP tool available: get_order_details
- CLI command available: carrefour-mcp search_products
- CLI command available: carrefour-mcp get_product_details
- CLI command available: carrefour-mcp auth_login
- CLI command available: carrefour-mcp auth_capture_cdp
- CLI command available: carrefour-mcp auth_status
- CLI command available: carrefour-mcp auth_logout
- CLI command available: carrefour-mcp list_orders
- CLI command available: carrefour-mcp get_order_details
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
pnpm cli -- get_product_details "3608580823445"
pnpm cli -- get_product_details "https://www.carrefour.fr/p/jus-de-carotte-pur-jus-carrefour-extra-3560070583379"
pnpm cli -- auth_login
pnpm cli -- auth_capture_cdp
pnpm cli -- auth_status
pnpm cli -- list_orders --limit 10
pnpm cli -- list_orders --limit 10 --cdp-url http://127.0.0.1:9222
pnpm cli -- get_order_details 649654675
pnpm cli -- get_order_details 649654675 --cdp-url http://127.0.0.1:9222
pnpm cli -- auth_logout
```

Use the installed binary command:

```bash
pnpm build
pnpm link --global
carrefour-mcp search_products "jus de carottes"
carrefour-mcp search_products "jus de carottes" --limit 5
carrefour-mcp get_product_details "3608580823445"
carrefour-mcp get_product_details "https://www.carrefour.fr/p/jus-de-carotte-pur-jus-carrefour-extra-3560070583379"
carrefour-mcp auth_login
carrefour-mcp auth_capture_cdp
carrefour-mcp auth_status
carrefour-mcp list_orders --limit 10
carrefour-mcp list_orders --limit 10 --cdp-url http://127.0.0.1:9222
carrefour-mcp get_order_details 649654675
carrefour-mcp get_order_details 649654675 --cdp-url http://127.0.0.1:9222
carrefour-mcp auth_logout
```

Output format:

- Raw JSON on stdout

## Authenticate Your Carrefour Session

To access account-only features such as order history:

1. Run `auth_login`.
2. Complete login manually in the opened browser window.
3. The browser runs with a persistent local profile (not a temporary guest-like profile).
4. The session state is saved locally and reused by authenticated tools.

Check status:

```bash
pnpm cli -- auth_status
```

Clear local session state:

```bash
pnpm cli -- auth_logout
```

List order history:

```bash
pnpm cli -- list_orders --limit 20
```

`list_orders` returns structured order history fields when available:

- order id
- order date
- order date in ISO format (`YYYY-MM-DD`)
- order amount and currency
- delivery time slot
- billed flag (`true` when the order is marked as invoiced)
- order detail URL

`get_order_details` returns structured fields from a single order detail page:

- order id and URL
- order date (ISO format)
- billed flag
- delivery type, address, and delivery slot
- order total and currency
- invoice/reorder/refund URLs when available
- unavailable products count when available
- product lines including unavailable products
- each product line can include name, product ID, packaging, quantity, prices, currency, and product URL
- category labels (for example `Conserves et bocaux`) are not returned as products

If Cloudflare challenge pages are returned by automated browsing, reuse your manually authenticated Chrome session with CDP:

```bash
pnpm cli -- list_orders --limit 20 --cdp-url http://127.0.0.1:9222
```

### Fallback: Capture Session From Existing Chrome

If `auth_login` fails during Cloudflare checks, you can reuse a browser session that you authenticated manually.

1. Start Chrome with remote debugging enabled:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.cache/carrefour-mcp/manual-chrome"
```

1. In that Chrome window, log in to Carrefour and validate the human check manually.

2. Capture the authenticated session state:

```bash
pnpm cli -- auth_capture_cdp
```

Optional custom CDP endpoint:

```bash
pnpm cli -- auth_capture_cdp --cdp-url http://127.0.0.1:9222
```

`get_product_details` returns detailed product information when available, including:

- product name and URL
- price and currency
- price per unit (for example `€/L`)
- Nutri-Score
- ingredients and nutrition facts
- product images

You can pass either an absolute Carrefour product URL or a numeric product ID to `get_product_details`.

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

## Authentication Configuration

- CARREFOUR_AUTH_ENABLED (default: true)
- CARREFOUR_AUTH_STATE_PATH (default: ~/.cache/carrefour-mcp/auth-state.json)
- CARREFOUR_AUTH_BROWSER_PROFILE_DIR (default: ~/.cache/carrefour-mcp/chromium-profile)
- CARREFOUR_AUTH_BROWSER_CHANNEL (optional: chromium, chrome, msedge)
- CARREFOUR_AUTH_LOGIN_TIMEOUT_MS (default: 180000)
