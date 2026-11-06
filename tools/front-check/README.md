# Vérification du front dans un navigateur

Scripts Node (22 ou plus, sans dépendance : `fetch` et `WebSocket` sont dans Node) qui pilotent un Chrome sans fenêtre par
le protocole DevTools. Ils sont nés d'un constat : `curl` ne voit ni un routeur cassé, ni un WebSocket qui ne passe pas à
travers le proxy Next. Un vrai navigateur, si.

## Avant de lancer
- La stack et le front : `make up && make web` (front Next sur http://localhost:3000, dépôt GGCoreFront voisin).
- Des données à parcourir : `make e2e-tournament` crée un tournoi « E2E ... » (poules, deux arbres) ; `make tournament
  F=fake-gglan-32.json` en crée un de 32 équipes.
- Le mot de passe admin : `make admin`.
- Chrome installé ; `CHROME=<chemin>` si ce n'est pas `C:/Program Files/Google/Chrome/Application/chrome.exe`.
- Les scripts utilisent **ta vraie base de développement** (les volumes Docker habituels) : `admin-flows.mjs` supprime ce
  qu'il crée, les autres ne créent rien, mais supprime à la main les tournois de test dont tu n'as plus besoin.

## Les scripts
Chemins de sortie : un chemin absolu de type `C:/...` (Windows) ; les captures d'écran y sont écrites.

| Script | Ce qu'il fait |
|---|---|
| `walk-screens.mjs <url> <mot de passe> <sortie> [visitor] [filtre]` | Parcourt les écrans (admin, ou visiteur sans connexion) : erreurs console, requêtes en échec, WebSocket (créé, trames reçues), texte de la page, capture. `T_PREFIX=Fake` choisit le tournoi par son préfixe, `CLIP_Y=5200` capture plus bas dans une page longue, `STEP_ROUND=9 STEP_MATCH=<id>` fait avancer un match de la sandbox pendant que la page est ouverte et dit si elle s'est mise à jour sans rechargement. Le filtre est un morceau d'adresse (`/view/tournaments`). |
| `admin-flows.mjs <url> <mot de passe> <sortie>` | Joue dans l'interface : créer un tournoi, ajouter un serveur et voir sa carte (état des logs CS2) ; vérifie aussi côté API et nettoie. |
| `sandbox-flow.mjs <url> <mot de passe> <sortie>` | Joue la page Sandbox match : presets, fixtures, injection d'un état, replay dust2 13-0 round par round (suivant, aller au round, précédent), simulation, console. Le match `m-sandbox-1` garde son état entre deux exécutions (la première vérification « scoreboard vide » ne passe que sur un match neuf). |

## Limites
- Le login Steam ne peut pas être joué (Internet et un compte Steam).
- Lancer un game et les boutons RCON demandent un serveur CS2 (`make up-cs2`).
- Les sélecteurs retrouvent les boutons par leur texte : si un libellé change, le script le dit (`INTROUVABLE`).
