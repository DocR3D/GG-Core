# Architecture cible — tournois (CS2 d'abord, multi-jeux plus tard)

> Statut : **validé (2026-10-30)**. Règle d'or : **rester simple** — ne construire que ce dont le MVP a besoin, mais
> ne fermer aucune porte qui coûterait une réécriture plus tard.

## 1. Objectif du MVP

Un **tournoi CS2 complet à la prochaine GGLan, sans Toornament** :
1. import des équipes / joueurs depuis le site d'inscription existant, **en CSV** pour commencer (API possible plus
   tard ; GG-Core ne gère pas les inscriptions) ;
2. poules et arbre (simple / double élimination) ;
3. lancement des matchs sur les serveurs (déjà prêt : `POST /api/matches/:id/start`) ;
4. résultats automatiques (moteur CS2) + **saisie admin** en secours ;
5. pages arbre / résultats publiques et console admin.

## 2. Décisions

| # | Décision |
|---|---|
| D1 | Le moteur CS2 actuel (agent, règles, Redis, Sandbox, arbitrage du Game Over) est conservé tel quel : c'est le futur « module CS2 ». |
| D2 | Un match oppose **deux équipes** (séries BOn, découpées en games). Le FFA / battle royale n'est pas prévu ; s'il arrive, ce sera un **nouveau type de match** à N participants ajouté à côté, sans réécriture. |
| D3 | Les tables de l'arbre ne contiennent que du **générique** : équipes, scores, vainqueur, statut. Les concepts CS (kills, ADR, rounds, économie, démo) vivent dans des **tables CS rattachées au game**. |
| D4 | Saisie manuelle des résultats par **l'admin** d'abord ; circuit capitaine (déclare / confirme / conteste) plus tard. |
| D5 | Pendant la LAN : **une seule instance locale** ; publication en ligne via un **tunnel sortant** (port 443, aucun port entrant — les réseaux de LAN sont filtrés). Optionnel : s'il tombe, seul le site public est indisponible. |
| D6 | Après la LAN : **copie ponctuelle** (base + démos) vers une instance hébergée en lecture seule. Pas de synchronisation continue. |

## 3. Ce qu'on fait maintenant (presque gratuit, pénible à rattraper plus tard)

- Un champ `game` sur `Tournament` et `Server` (une seule valeur : `cs2`).
- Le résultat d'un game porte sa **source** (`automatic` | `manual`), son **statut** (`reported` | `confirmed` |
  `disputed`) et son **auteur** — nécessaire de toute façon pour la saisie admin, et prêt pour le circuit capitaine.
- Aucun concept CS dans les tables de l'arbre (D3). Les stats CS restent dans `PlayerMapStats` (+ journal
  `events_primary`, démo), rattachées au game.
- Identifiants **UUID** partout (déjà le cas), `updatedAt` sur les données de tournoi, aucune donnée propre à une
  machine (chemins, IP) dans ces tables.

## 4. Affichage : générique + bloc propre au jeu

| Où | Contenu | Exemple |
|---|---|---|
| Match (générique) | équipes, score de la série, vainqueur, statut | Team A **2-1** Team B |
| Game (générique) | score, vainqueur, source, statut, map optionnelle | de_mirage **13-11** |
| Tables CS (module CS2) | stats joueurs, historique des rounds, démo GOTV, journal d'événements | rattachées au game |

L'arbre et les classements n'affichent que le générique (même code pour tous les jeux). La page d'un match ajoute un
**bloc CS2** (scoreboard K/D/ADR, rounds, démo) ; le direct utilise les événements WebSocket CS existants.

## 5. Plus tard — seulement quand le besoin arrive

| Quand | Quoi |
|---|---|
| 2ᵉ jeu | `PlayerMapStats` devient une **table de stats commune** (kills / deaths / assists / score + colonne JSON pour les stats propres au jeu : ADR, HS, MVP pour CS…), réutilisée par tous les jeux qui se ressemblent ; table dédiée seulement pour un jeu qui n'entre pas dans ce moule (BR) |
| 2ᵉ jeu | Interface « module de jeu » (CS2 en devient l'implémentation) ; jeux à saisie manuelle décrits par des **données** (nom, maps, format du score) sans code |
| Premier jeu hors Steam | Comptes joueurs par plateforme (`PlayerAccount`) au lieu de `Player.steamId` |
| Beaucoup de matchs simultanés | Circuit capitaine (nécessite des comptes joueurs / JWT) |
| Site public pendant la LAN | Tunnel sortant (candidat : Cloudflare Tunnel) |
| Consultation post-LAN | Export base + démos (stockage de fichiers, jamais dans PostgreSQL) |
| Jeu FFA / BR | Type de match à N participants classés, barème de points |

## 6. Options écartées

| Option | Pourquoi |
|---|---|
| Miroir distant poussé régulièrement / passage de relais local ↔ distant | Plus complexe que le tunnel ; les inscriptions restent sur le site existant. Restent possibles grâce aux UUID / `updatedAt`. |
| Multi-maître (réplication bidirectionnelle) | Gestion des conflits disproportionnée |
| Cloud d'abord (comme Toornament) | Contraire au LAN-first |
| Une application par jeu | Plusieurs applications pour un même besoin |
| Une table de stats par jeu / stats en clé-valeur | Une migration par jeu et des classements multi-tables / requêtes pénibles ; la table commune + JSON couvre les jeux d'équipe |
| Participants génériques (N) dès maintenant | Complexité inutile tant qu'aucun jeu FFA n'est prévu (D2) |

## 7. Questions ouvertes

1. Format d'import : le dev du site d'inscription peut fournir un **CSV sur mesure ou un endpoint** (a minima pseudo et
   e-mail) — à définir au moment de l'import.
2. Hébergeur de l'instance post-LAN et du stockage des démos.
