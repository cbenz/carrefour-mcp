# SPEC.md

## Objectif

Interagir avec le site `https://www.carrefour.fr` pour récupérer des informations sur les produits, ajouter des produits au panier.

## Technologies

- serveur MCP
- TypeScript
- Node.js
- Playwright (Chromium)
- Commander.js pour le CLI

## Fonctionnalités

- Le serveur expose un transport `stdio` pour les clients MCP locaux.
- Le serveur expose aussi un transport `http` (endpoint MCP) pour une exécution distante.
- Le démarrage est piloté par variable d'environnement :
  - `MCP_TRANSPORT=stdio` pour `stdio` seul
  - `MCP_TRANSPORT=http` pour `http` seul
  - `MCP_TRANSPORT=both` pour lancer les deux
- Le projet expose aussi un lanceur CLI `carrefour-mcp`.
- Le CLI supporte des sous-commandes alignées sur les outils MCP via une librairie CLI standard.
- Le CLI écrit sur `stdout` les données brutes JSON du tool appelé.
- Le projet inclut des tests unitaires pour le parsing DOM des cartes produits et la mise en cache du tool `search_products`.

## MCP Tools

- `search_products`: exécute une requête de recherche full-text et retourne une liste de produits correspondants
- `get_product`: récupère les détails d'une fiche produit Carrefour à partir de son URL

### `search_products`

- Input:
  - `query` (string, requis)
  - `limit` (number, optionnel, défaut: 10, max: 30)
- Output:
  - liste de produits avec au minimum:
    - `name`
    - `url`
    - `price` (quand disponible)
    - `currency` (quand disponible)
    - `image` (quand disponible)
  - métadonnées de recherche:
    - `query`
    - `count`
- Implémentation:
  - la récupération de la page de recherche se fait via Playwright avec Chromium headless pour limiter les réponses `403`
  - l'extraction des produits se fait depuis le DOM rendu de la liste de résultats
  - les données de page sont mises en cache sur disque pour éviter de requêter le site à chaque appel identique
  - le cache est configurable via variables d'environnement:
    - `CARREFOUR_SEARCH_CACHE_ENABLED` (défaut: `true`)
    - `CARREFOUR_SEARCH_CACHE_DIR` (défaut: `.cache/carrefour-mcp`)
    - `CARREFOUR_SEARCH_CACHE_TTL_MS` (défaut: `900000` ms)

### CLI

- Commande:
  - `carrefour-mcp search_products "jus de carottes"`
- Options supportées:
  - `--limit <number>` pour limiter le nombre de produits retournés
- Sortie:
  - JSON brut correspondant aux données structurées du tool `search_products`

### `get_product`

- Input:
  - `url` (string, requis, URL absolue d'une fiche produit Carrefour)
- Output:
  - détails du produit avec au minimum:
    - `name`
    - `url`
    - `price` (quand disponible)
    - `currency` (quand disponible)
    - `unitPrice` (quand disponible, ex: `€/L`)
    - `nutriScore` (quand disponible)
    - `ingredients` (quand disponible)
    - `nutritionFacts` (quand disponible)
    - `images` (quand disponibles)
- Implémentation:
  - la page produit est chargée via Playwright (Chromium headless)
  - l'extraction se fait depuis le DOM rendu de la fiche produit
  - un repli JSON-LD est utilisé pour certains champs structurés (ex: marque, prix) quand disponible

### CLI (`get_product`)

- Commande:
  - `carrefour-mcp get_product "https://www.carrefour.fr/p/..."`
- Sortie:
  - JSON brut correspondant aux données structurées du tool `get_product`
