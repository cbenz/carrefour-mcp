# SPEC.md

## Objectif

Interagir avec le site `https://www.carrefour.fr` pour récupérer des informations sur les produits et accéder à l'historique des commandes d'un compte authentifié.

## Technologies

- serveur MCP
- TypeScript
- Node.js
- Playwright (Chromium)
- Commander.js pour le CLI

## Déploiement

- Le projet fournit un sous-répertoire `deploy/` versionné dans Git.
- Le script d'installation du dépôt crée l'utilisateur Unix dédié, installe les paquets Debian nécessaires (dont `chromium` et `xauth`), clone ou met à jour le dépôt Git sur le serveur, installe Chromium pour Playwright via `npm run install:browsers`, déploie l'unité systemd et démarre le service.
- Si le service systemd est déjà actif, le script d'installation le redémarre explicitement après le build pour charger les nouveaux artefacts.
- L'unité systemd de production applique un redémarrage agressif: délai de relance court (`RestartSec=1`) et délai d'arrêt réduit (`TimeoutStopSec=10s`).
- Le script d'installation peut être exécuté depuis une simple copie du fichier (par exemple via `scp`) sans checkout local préalable.
- Si `REPO_URL` n'est pas fourni et qu'aucune métadonnée Git locale n'est disponible, le script utilise `https://github.com/cbenz/carrefour-mcp`.
- Si `REPO_BRANCH` n'est pas fourni et ne peut pas être détecté, le script utilise `main`.
- Le service systemd démarre depuis le répertoire de build `dist` du checkout serveur.
- Le serveur HTTP reste lié à `127.0.0.1:3000` sur la machine de production.

## Fonctionnalités

- Le serveur expose un transport `stdio` pour les clients MCP locaux.
- Le serveur expose aussi un transport `http` (endpoint MCP) pour une exécution distante.
- Les tools d'authentification et de commandes utilisent un stockage de session Carrefour unique, partagé par l'instance.
- Le démarrage est piloté par variable d'environnement :
  - `MCP_TRANSPORT=stdio` pour `stdio` seul
  - `MCP_TRANSPORT=http` pour `http` seul
  - `MCP_TRANSPORT=both` pour lancer les deux
- Le projet expose aussi un lanceur CLI `carrefour-mcp`.
- Le CLI supporte des sous-commandes alignées sur les outils MCP via une librairie CLI standard.
- La syntaxe documentée et supportée pour l'exécution via script package manager est `pnpm cli <commande>` sans séparateur `--`.
- Pour un usage pipeable (stdout JSON uniquement), la syntaxe recommandée est `pnpm --silent cli <commande>`.
- Le CLI écrit sur `stdout` les données brutes JSON du tool appelé; les messages non-JSON doivent rester sur `stderr`.
- Si le consommateur du pipe ferme `stdout` prématurément (erreur `EPIPE`, ex. avec `| head`), le CLI doit terminer proprement sans stacktrace.
- Le projet inclut des tests unitaires pour le parsing DOM des cartes produits et la mise en cache du tool `search_products`.
- Le projet inclut des tests unitaires pour le parsing des données d'authentification et des commandes.

## Règles globales de tests unitaires

- Les fixtures HTML ne doivent pas être des blocs texte minimaux artificiels.
- Les fixtures HTML doivent refléter la structure réelle observée dans le DOM des pages ciblées.

## MCP Tools

- `auth_capture_state`: attache une session navigateur déjà authentifiée (CDP) pour sauvegarder la session
- `auth_import_state`: importe un état d'authentification Playwright sérialisé pour un usage distant
- `auth_status`: vérifie si la session authentifiée locale existe et est encore valide
- `auth_logout`: supprime la session locale sauvegardée
- `list_orders`: récupère l'historique des commandes du compte authentifié
- `get_order_details`: récupère les détails structurés d'une commande du compte authentifié
- `search_products`: exécute une requête de recherche full-text et retourne une liste de produits correspondants
- `get_product_details`: récupère les détails d'une fiche produit Carrefour à partir de son URL ou de son identifiant produit
- `add_to_cart`: ajoute une liste de produits au panier Carrefour de l'utilisateur authentifié via Playwright ; si le bouton « Ajouter au panier » est absent sur une page produit, le produit est considéré comme déjà dans le panier (pas une erreur) ; le résultat distingue les produits ajoutés (`added`), les produits déjà dans le panier (`alreadyInCart`) et les vrais échecs (`failed`)

## CLI Commands (local only)

- `auth_login`: affiche une commande SSH `-Y` recommandée pour lancer Chromium sur la machine distante avec remote debugging
- `auth_capture_state`: capture la session depuis Chrome via CDP
- `auth_status`: vérifie l'état de la session locale
- `auth_logout`: supprime la session locale
- `list_orders`: récupère l'historique des commandes
- `get_order_details`: récupère les détails d'une commande
- `search_products`: recherche des produits
- `get_product_details`: récupère les détails d'un produit

### CLI: `auth_login`

- Affiche une commande recommandée pour lancer Chromium sur l'hôte distant via SSH avec X11 forwarding:
  - format: `ssh -Y <ssh-target> chromium --remote-debugging-port=<port dérivé du cdp-url> --user-data-dir=<profil manuel distant> https://www.carrefour.fr/mon-compte`
  - valeur par défaut de `<ssh-target>`: `coursicota@203.0.113.42`
  - override possible via `CARREFOUR_AUTH_SSH_TARGET`
- La commande suggérée inclut remote debugging activé:
  - `--remote-debugging-port=<port dérivé du cdp-url>`
  - `--user-data-dir=<profil manuel distant>`
  - URL initiale `https://www.carrefour.fr/mon-compte`
- Le CLI affiche la commande exacte à exécuter, pas un bloc JSON
- L'utilisateur doit manuellement compléter le login et les challenges Cloudflare dans le navigateur
- Le CLI ne capture PAS la session: la capture se fait ensuite via `auth_capture_state` ou `auth_capture_state --cleanup-profile`

### `auth_status`

- Input:
  - aucun
- Output:
  - `authenticated` (boolean)
  - `statePath` (string)
  - `updatedAt` (string, optionnel)
  - `reason` (string, optionnel)

### `auth_capture_state`

- Input:
  - `cdpUrl` (string URL, optionnel, défaut: `http://127.0.0.1:9222`)
  - `authStatePath` (string, optionnel, chemin de fichier où sauvegarder le storageState)
  - `cleanupProfile` (boolean, optionnel, défaut: `true`, CLI uniquement)
  - `profileDir` (string, optionnel, chemin du profil manuel à nettoyer, CLI uniquement)
- Output:
  - `authenticated` (boolean)
  - `statePath` (string)
  - `message` (string)
- Implémentation:
  - se connecte en CDP à un navigateur déjà ouvert
  - vérifie l'état authentifié Carrefour
  - sauvegarde la session Playwright (`storageState`) localement vers `authStatePath` si fourni
  - si `authStatePath` n'est pas fourni, lit `CARREFOUR_AUTH_CAPTURE_STATE_PATH` puis `CARREFOUR_AUTH_STATE_PATH`
  - en mode CLI, peut supprimer le répertoire de profil manuel après capture réussie (`cleanupProfile=true`)

### `auth_import_state`

- Input:
  - `storageState` (object, requis, format Playwright `storageState`)
  - `destinationPath` (string, optionnel, chemin du fichier de destination ; utilise `CARREFOUR_AUTH_STATE_PATH` si non fourni)
- Output:
  - `imported` (boolean)
  - `statePath` (string)
  - `updatedAt` (string ISO 8601)
  - `message` (string)
- Implémentation:
  - valide le payload minimal (`cookies` array et `origins` array)
  - écrit l'état importé à `destinationPath` (si fourni) ou au chemin d'état par défaut

### `auth_logout`

- Input:
  - aucun
- Output:
  - `loggedOut` (boolean)
  - `statePath` (string)

## Stockage de session d'authentification

- Le storage state Playwright est persisté dans un fichier JSON local unique par instance.
- Le chemin du fichier JSON local est configuré via `CARREFOUR_AUTH_STATE_PATH` (défaut: `~/.cache/carrefour-mcp/auth-state.json`).

### `list_orders`

- Input:
  - `limit` (number, optionnel, max: 100 ; si omis, retourne toutes les commandes disponibles)
  - `cdpUrl` (string URL, optionnel, ex: `http://127.0.0.1:9222`)
  - `startDate` (string ISO 8601, optionnel, ex: `2024-01-01T00:00:00.000Z` pour filtrer à partir de cette date)
  - `endDate` (string ISO 8601, optionnel, ex: `2024-12-31T23:59:59.999Z` pour filtrer jusqu'à cette date)
- Output:
  - liste de commandes avec au minimum:
    - `id` (numéro de commande)
    - `date` (quand disponible, format ISO `YYYY-MM-DD`)
    - `total` (quand disponible)
    - `currency` (quand disponible)
    - `status` (quand disponible)
    - `timeSlot` (quand disponible, ex: `09h00 - 11h00`)
    - `billed` (quand disponible, booléen)
    - `detailUrl` (quand disponible)
  - ordre de tri: commandes triées par date décroissante (plus récente vers plus ancienne)
- Implémentation:
  - utilise l'API interne `https://www.carrefour.fr/api/user/orders` avec les cookies de la session authentifiée
  - en mode auth state : lit les cookies depuis le fichier JSON local
  - en mode CDP : se connecte au navigateur via CDP, extrait les cookies Carrefour, puis appelle l'API HTTP
  - pagination par curseur : première requête sur `page=1&pageSize=20`, puis requêtes suivantes avec `scrollPaging` et `scrollHash` retournés dans `meta`
  - itère jusqu'à obtenir `limit` commandes si `limit` est fourni, sinon jusqu'à épuisement du curseur
  - résilience pagination: si l'API Carrefour renvoie un `400` pendant une page suivante (après au moins une page valide), le tool retourne les commandes déjà collectées au lieu d'échouer
  - en cas de `401` ou `403`, le serveur journalise les détails de la réponse Carrefour (URL, status, extrait du body) pour faciliter le diagnostic
  - si un `400` survient dès la première page, le tool renvoie une erreur explicite
  - protection anti-boucle : arrête la pagination si une page duplique exactement la précédente ou si aucune nouvelle commande n'est ajoutée
  - headers requis : `Cookie`, `Accept: application/json`, `Referer`, `Origin`, `X-Requested-With: XMLHttpRequest`
  - mapping des champs API :
    - `id` ← `attributes.orderNumber`
    - `date` ← 10 premiers caractères de `attributes.date` (format `YYYY-MM-DD`)
    - `total` ← `attributes.totalAmount`
    - `status` ← `attributes.orderStatus`
    - `timeSlot` ← dérivé de `attributes.slot.dateBegin` / `slot.dateEnd` (format `HHhMM - HHhMM`)
    - `billed` ← `links.getStatement !== null`
    - `detailUrl` ← URL absolue dérivée de `links.orderDetailsPage`
  - tri final : toutes les commandes agrégées sont triées par `date` décroissante; les commandes sans date sont placées en fin de liste

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
  - `products` (array, optionnel, triée par `productId` ordre numérique croissant)
    - `name` (string, requis)
    - `productId` (string, optionnel)
    - `category` (string, optionnel, nom de la catégorie de rayon)
    - `unavailable` (boolean, requis)
    - `quantity` (number, optionnel)
    - `packaging` (string, optionnel)
    - `totalPrice` (number, optionnel)
    - `unitPrice` (number, optionnel)
    - `currency` (string, optionnel)
    - `url` (string, optionnel)
- Implémentation:
  - utilise l'API interne `https://www.carrefour.fr/api/user/orders/{orderNumber}` avec les cookies de la session authentifiée
  - en mode auth state : lit les cookies depuis le fichier JSON local
  - en mode CDP : se connecte au navigateur via CDP et utilise son contexte de requête pour appeler l'API
  - en cas de `401` ou `403`, le serveur journalise les détails de la réponse Carrefour (URL, status, extrait du body) pour faciliter le diagnostic
  - extrait la commande de la réponse JSON (`attributes`)
  - extrait les produits depuis `productList.categories[].products[]`
  - trie les produits par `productId` en ordre numérique croissant
  - headers requis : `Accept: application/json`, `Referer`, `Origin`, `X-Requested-With: XMLHttpRequest`
  - mapping des champs API :
    - `id` ← `attributes.orderNumber`
    - `orderedAt` ← 10 premiers caractères de `attributes.date` (format `YYYY-MM-DD`)
    - `billed` ← `true` si `attributes.isPaidOnSite === false`, sinon `undefined`
    - `deliverySlot` ← dérivé de `attributes.slot.dateBegin` / `slot.dateEnd` (format `HHhMM - HHhMM`)
    - `total` ← `attributes.totalAmount`
    - `invoiceUrl` ← URL absolue dérivée de `links.getStatement`
    - `refundUrl` ← URL absolue dérivée de `links.refundPage`
    - **Produits** :
      - `name` ← `attributes.title` du produit
      - `productId` ← `attributes.ean` du produit
      - `totalPrice` ← prix livré depuis `offers[ean][storeId].attributes.price.totalPrice.delivered`
      - `unitPrice` ← prix unitaire depuis `offers[ean][storeId].attributes.price.price`
      - `url` ← URL absolue construite depuis le `slug` et l'`ean` du produit

### Spécification de mapping `get_order_details`

- Source : réponse JSON de `GET /api/user/orders/{orderNumber}`
- Structure de réponse :
  - `attributes` : métadonnées de la commande
  - `attributes.productList.categories[]` : array de catégories de produits
  - `attributes.productList.categories[].products[]` : array de produits par catégorie
  - `links` : liens relatifs (facture, remboursement, etc.)
- Règles de mapping :
  - `id` : `attributes.orderNumber`
  - `orderedAt` : sous-chaîne `[0..9]` de `attributes.date` (`YYYY-MM-DD HH:MM:SS` → `YYYY-MM-DD`)
  - `deliverySlot` : extraction du motif `HHhMM - HHhMM` depuis `slot.dateBegin` et `slot.dateEnd`
  - `billed` : `true` si `attributes.isPaidOnSite === false`, sinon `undefined`
  - `invoiceUrl` : URL absolue dérivée de `links.getStatement`
  - `refundUrl` : URL absolue dérivée de `links.refundPage`
  - **Produits** (triés par `productId` ordre numérique croissant) :
    - `name` : `attributes.title`
    - `productId` : `attributes.ean`      - `category` : `name` de la catégorie parente    - `totalPrice` : `offers[ean][storeId].attributes.price.totalPrice.delivered`
    - `unitPrice` : `offers[ean][storeId].attributes.price.price`
    - `url` : URL absolue construite depuis `slug` et `ean` (format: `/p/{slug}-{ean}`)

### Exigences de tests unitaires `get_order_details`

- Test `extractOrderDetailsFromApi` avec une fixture JSON réaliste reflétant la structure réelle de l'API :
  - `attributes.orderNumber`, `attributes.date` (format `YYYY-MM-DD HH:MM:SS`), `attributes.totalAmount`
  - `attributes.slot.dateBegin` / `slot.dateEnd` (format `YYYY-MM-DD HH:MM:SS`)
  - `attributes.productList.categories[].products[]` avec structure complète d'offers imbriquées
  - `links.getStatement`, `links.refundPage`
- Les assertions doivent vérifier explicitement :
  - format ISO de la date (`YYYY-MM-DD`)
  - extraction correcte de l'`id` depuis `orderNumber`
  - extraction du `deliverySlot` (format `HHhMM - HHhMM`)
  - extraction du flag `billed`
  - extraction correcte des produits avec `name`, `productId`, `category`, `totalPrice`, `unitPrice`
  - tri des produits par `productId` ordre numérique croissant
  - extraction de l'`url` produit depuis le `slug`
- Conserver les tests existants de parsing HTML (`extractOrderDetailsFromHtml`, etc.) pour la rétrocompatibilité

### Spécification de mapping `list_orders`

- Source : réponse JSON de `GET /api/user/orders?page=1&pageSize=20[&scrollPaging=<cursor>&scrollHash=<hash>]`
- Structure de réponse :
  - `data[]` : array de commandes
  - `meta.scrollPaging` : curseur de pagination pour la page suivante
  - `meta.scrollHash` : hash de pagination associé au curseur
- Règles de mapping par commande :
  - `id` : `attributes.orderNumber`
  - `date` : sous-chaîne `[0..9]` de `attributes.date` (`YYYY-MM-DD HH:MM:SS` → `YYYY-MM-DD`)
  - `timeSlot` : extraction du motif `HHhMM - HHhMM` depuis `slot.dateBegin` et `slot.dateEnd`
  - `billed` : `true` si `links.getStatement` est non-null, sinon `undefined`
  - `detailUrl` : URL absolue Carrefour construite depuis `links.orderDetailsPage`

### Exigences de tests unitaires `list_orders`

- Test `extractOrdersFromApiResponse` avec une fixture JSON réaliste reflétant la structure réelle de l'API :
  - `attributes.orderNumber`, `attributes.date` (format `YYYY-MM-DD HH:MM:SS`), `attributes.totalAmount`
  - `attributes.slot.dateBegin` / `slot.dateEnd` (format `YYYY-MM-DD HH:MM:SS`)
  - `links.orderDetailsPage`, `links.getStatement`
- Les assertions doivent vérifier explicitement :
  - format ISO de la date (`YYYY-MM-DD`)
  - extraction correcte de l'`id`
  - extraction du `timeSlot` (format `HHhMM - HHhMM`)
  - extraction du flag `billed`
  - extraction du montant numérique
- Conserver les tests existants de parsing HTML (`extractOrdersFromHtml`, etc.) pour la rétrocompatibilité

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
  - `carrefour-mcp auth_capture_state`
  - `carrefour-mcp auth_status`
  - `carrefour-mcp auth_logout`
  - `carrefour-mcp list_orders`
  - `carrefour-mcp get_order_details`
- Options supportées:
  - `--limit <number>` pour limiter le nombre de produits retournés
  - `auth_login --timeout-ms <number>` option conservée pour compatibilité (sans effet)
  - `auth_login --cdp-url <url>` pour choisir le endpoint CDP visé ensuite
  - `auth_login --profile-dir <path>` pour choisir le répertoire de profil manuel Chromium distant
  - `auth_login --chrome-bin <path|name>` pour choisir le binaire Chromium/Chrome distant
  - `auth_login --ssh-target <user@host>` pour choisir l'hôte SSH du navigateur distant
  - `auth_capture_state --cleanup-profile` pour nettoyer le profil manuel après capture réussie
  - `auth_capture_state --profile-dir <path>` pour choisir le répertoire de profil à nettoyer
  - `auth_capture_state --auth-state-path <path>` pour choisir le chemin de sauvegarde du `storageState`
  - `list_orders --limit <number>` pour limiter le nombre de commandes retournées
  - `list_orders --cdp-url <url>` pour lire les commandes via une session navigateur déjà ouverte
  - `list_orders --start-date <iso>` pour filtrer les commandes à partir de cette date (format ISO 8601)
  - `list_orders --end-date <iso>` pour filtrer les commandes jusqu'à cette date (format ISO 8601)
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
  - `CARREFOUR_AUTH_MANUAL_PROFILE_DIR` (défaut: `~/.cache/carrefour-mcp/manual-chrome`)
  - `CARREFOUR_AUTH_CDP_URL` (défaut: `http://127.0.0.1:9222`)
  - `CARREFOUR_AUTH_CHROME_BIN` (défaut: `google-chrome`)
- Cache de recherche:
  - `CARREFOUR_SEARCH_CACHE_ENABLED` (défaut: `true`)
  - `CARREFOUR_SEARCH_CACHE_DIR` (défaut: `.cache/carrefour-mcp`)
  - `CARREFOUR_SEARCH_CACHE_TTL_MS` (défaut: `900000` ms)
