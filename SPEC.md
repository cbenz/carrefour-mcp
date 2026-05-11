# SPEC.md

## Objectif

Interagir avec le site `https://www.carrefour.fr` pour récupérer des informations sur les produits et accéder à l'historique des commandes d'un compte authentifié.

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
- Le projet inclut des tests unitaires pour le parsing des données d'authentification et des commandes.

## Règles globales de tests unitaires

- Les fixtures HTML ne doivent pas être des blocs texte minimaux artificiels.
- Les fixtures HTML doivent refléter la structure réelle observée dans le DOM des pages ciblées.

## MCP Tools

- `auth_login`: ouvre un navigateur visible pour une authentification manuelle Carrefour et sauvegarde la session
- `auth_capture_cdp`: attache une session navigateur déjà authentifiée (CDP) pour sauvegarder la session
- `auth_status`: vérifie si la session authentifiée locale existe et est encore valide
- `auth_logout`: supprime la session locale sauvegardée
- `list_orders`: récupère l'historique des commandes du compte authentifié
- `get_order_details`: récupère les détails structurés d'une commande du compte authentifié
- `search_products`: exécute une requête de recherche full-text et retourne une liste de produits correspondants
- `get_product_details`: récupère les détails d'une fiche produit Carrefour à partir de son URL ou de son identifiant produit

### `auth_login`

- Input:
  - `timeoutMs` (number, optionnel)
- Output:
  - `authenticated` (boolean)
  - `statePath` (string)
  - `message` (string)
- Implémentation:
  - ouvre un navigateur non-headless avec profil local persistant
  - l'utilisateur se connecte manuellement sur Carrefour
  - la session Playwright (`storageState`) est sauvegardée dans un fichier local

### `auth_status`

- Input:
  - aucun
- Output:
  - `authenticated` (boolean)
  - `statePath` (string)
  - `updatedAt` (string, optionnel)
  - `reason` (string, optionnel)

### `auth_capture_cdp`

- Input:
  - `cdpUrl` (string URL, optionnel, défaut: `http://127.0.0.1:9222`)
- Output:
  - `authenticated` (boolean)
  - `statePath` (string)
  - `message` (string)
- Implémentation:
  - se connecte en CDP à un navigateur déjà ouvert
  - vérifie l'état authentifié Carrefour
  - sauvegarde la session Playwright (`storageState`) localement

### `auth_logout`

- Input:
  - aucun
- Output:
  - `loggedOut` (boolean)
  - `statePath` (string)

### `list_orders`

- Input:
  - `limit` (number, optionnel, défaut: 20, max: 100)
  - `cdpUrl` (string URL, optionnel, ex: `http://127.0.0.1:9222`)
- Output:
  - liste de commandes avec au minimum:
    - `id` (numéro de commande extrait de l'URL ou du texte)
    - `date` (quand disponible, format ISO `YYYY-MM-DD`)
    - `total` (quand disponible)
    - `currency` (quand disponible)
    - `status` (quand disponible)
    - `timeSlot` (quand disponible, ex: `09h00 - 11h00`)
    - `billed` (quand disponible, booléen)
    - `detailUrl` (quand disponible)
- Implémentation:
  - utilise la session authentifiée sauvegardée
  - charge la page d'historique des commandes via Playwright depuis l'URL canonique `https://www.carrefour.fr/mon-compte/mes-achats/en-ligne`
  - supporte un mode d'attache CDP à un navigateur déjà authentifié
  - extrait les commandes depuis le DOM rendu

### `get_order_details`

- Input:
  - `orderRef` (string, requis: id de commande numérique ou URL absolue de détail commande Carrefour)
  - `cdpUrl` (string URL, optionnel, ex: `http://127.0.0.1:9222`)
- Output:
  - `id` (string, requis)
  - `url` (string, requis)
  - `orderedAt` (string ISO `YYYY-MM-DD`, optionnel)
  - `billed` (boolean, optionnel)
  - `deliveryType` (string, optionnel)
  - `deliveryAddress` (string, optionnel)
  - `deliverySlot` (string, optionnel)
  - `total` (number, optionnel)
  - `currency` (string, optionnel)
  - `invoiceUrl` (string, optionnel)
  - `reorderUrl` (string, optionnel)
  - `refundUrl` (string, optionnel)
  - `unavailableProductsCount` (number, optionnel)
  - `products` (array, optionnel)
    - `name` (string, requis)
    - `productId` (string, optionnel)
    - `unavailable` (boolean, requis)
    - `quantity` (number, optionnel)
    - `packaging` (string, optionnel)
    - `totalPrice` (number, optionnel)
    - `unitPrice` (number, optionnel)
    - `currency` (string, optionnel)
    - `url` (string, optionnel)
- Implémentation:
  - charge la page de détail commande `https://www.carrefour.fr/mon-compte/mes-achats/en-ligne/<id>`
  - supporte un mode d'attache CDP à un navigateur déjà authentifié
  - extrait les métadonnées clés de la commande depuis le DOM rendu
  - extrait aussi les lignes produits (incluant les produits indisponibles)
  - ignore les libellés de catégories de rayons (ex: `Conserves et bocaux`)

### Spécification de parsing `list_orders`

- La source primaire des commandes est la liste d'éléments de la page `mes-achats/en-ligne`.
- Chaque entrée de commande est attendue dans une structure de type `list`/`listitem` contenant au minimum:
  - une date de commande (ex: `28/04/26`)
  - un identifiant visible `N° <id>`
  - un montant (ex: `176,07€`)
  - un texte de livraison contenant le créneau horaire (ex: `09h00 - 11h00`)
  - un libellé de facturation (ex: `Facturée`)
  - un lien d'action `commander/<id>` et/ou un lien de détail de commande
- Règles d'extraction:
  - `id`: priorité au lien `.../commander/<id>`, fallback sur `N° <id>`
  - `date`: conversion obligatoire en ISO `YYYY-MM-DD`
  - `timeSlot`: extraction du motif `HHhMM - HHhMM`
  - `billed`: `true` si le libellé `Facturée` est présent, `false` si `Non facturée`, sinon `undefined`
  - `detailUrl`: URL absolue Carrefour

### Exigences de tests unitaires `list_orders`

- Les fixtures doivent refléter la structure réelle observée dans le DOM Carrefour de `mes-achats/en-ligne`, notamment:
  - conteneur de liste (`list`/`listitem` ou équivalent HTML)
  - sous-blocs distincts date / livraison / montant / actions
  - liens réalistes (`/mon-compte/mes-achats/en-ligne/<id>`, `/commander/<id>`, `/facture/<id>`)
- Les assertions doivent vérifier explicitement:
  - format ISO de la date
  - extraction correcte de l'`id`
  - extraction du `timeSlot`
  - extraction du flag `billed`
  - extraction du montant numérique

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
- Commande:
  - `carrefour-mcp auth_login`
  - `carrefour-mcp auth_capture_cdp`
  - `carrefour-mcp auth_status`
  - `carrefour-mcp auth_logout`
  - `carrefour-mcp list_orders`
  - `carrefour-mcp get_order_details`
- Options supportées:
  - `--limit <number>` pour limiter le nombre de produits retournés
  - `auth_login --timeout-ms <number>` pour configurer le timeout de connexion
  - `list_orders --limit <number>` pour limiter le nombre de commandes retournées
  - `list_orders --cdp-url <url>` pour lire les commandes via une session navigateur déjà ouverte
  - `get_order_details <orderRef>` pour récupérer le détail d'une commande
  - `get_order_details --cdp-url <url>` pour lire le détail commande via une session navigateur déjà ouverte
- Sortie:
  - JSON brut correspondant aux données structurées du tool `search_products`

### `get_product_details`

- Input:
  - `url` (string, requis, URL absolue d'une fiche produit Carrefour ou identifiant produit numérique)
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

### CLI (`get_product_details`)

- Commande:
  - `carrefour-mcp get_product_details "3608580823445"`
  - `carrefour-mcp get_product_details "https://www.carrefour.fr/p/..."`
- Sortie:
  - JSON brut correspondant aux données structurées du tool `get_product_details`

## Variables d'environnement

- Session d'authentification:
  - `CARREFOUR_AUTH_ENABLED` (défaut: `true`)
  - `CARREFOUR_AUTH_STATE_PATH` (défaut: `~/.cache/carrefour-mcp/auth-state.json`)
  - `CARREFOUR_AUTH_BROWSER_PROFILE_DIR` (défaut: `~/.cache/carrefour-mcp/chromium-profile`)
  - `CARREFOUR_AUTH_BROWSER_CHANNEL` (optionnel: `chromium`, `chrome`, `msedge`)
  - `CARREFOUR_AUTH_LOGIN_TIMEOUT_MS` (défaut: `180000` ms)
- Cache de recherche:
  - `CARREFOUR_SEARCH_CACHE_ENABLED` (défaut: `true`)
  - `CARREFOUR_SEARCH_CACHE_DIR` (défaut: `.cache/carrefour-mcp`)
  - `CARREFOUR_SEARCH_CACHE_TTL_MS` (défaut: `900000` ms)
