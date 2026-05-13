# AGENTS.md

## Skills

- `spec-driven-dev`: ce projet utilise cette méthodologie

## Règles de l'agent

- tu dois t'exprimer en français dans la session de chat
- si tu dois poser une question à l'utilisateur, utilise #tool:vscode/askQuestions
- avant toute modification de code, lis le skill `spec-driven-dev` et mets à jour `SPEC.md` en premier
- avant toute modification de code impliquant une librairie externe, utilise le MCP context7 pour trouver sa documentation

## Règles de projet

- maintiens toujours `README.md` synchronisé avec `SPEC.md` et le code source
- `README.md` doit être un guide destiné à l'utilisateur et ne pas contenir d'informations techniques sur l'implémentation (même si l'utilisateur est un développeur)

## Règles de code

- utilise l'anglais pour les identifiants (variables, sélecteurs CSS, identifiants HTML, fonctions, classes, etc.)
- écris les commentaires en anglais
- écris les messages destinés à l'utilisateur en anglais

## Règles de données

- les dates en sortie de tool doivent être au format ISO 8601

## Règles de test

- les tests unitaires doivent être écrits en anglais
- les tests qui utilisent des données mockées (e.g. HTML dummy) doivent être réalistes et refléter la structure réelle du site web ciblé
- lorsqu'un bug est constaté, tu dois modifier d'abord les tests pour reproduire le bug (si besoin), et ensuite corriger le bug, et enfin constater que les tests passent

## Règles de rédaction

- lorsque tu écris en français, mets les accents, même sur les majuscules, même si l'utilisateur ne les utilise pas dans sa demande

## Technologies

- `pnpm` plutôt que `npm`
