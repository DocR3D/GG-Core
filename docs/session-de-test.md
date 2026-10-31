# Session de test - liste à dérouler

Tout ce qui ne se vérifie qu'avec de vrais joueurs dans CS2 et un humain devant les écrans. Le détail de chaque test
RT (contexte, procédure, résultat attendu) est dans [`test-cases.md`](./test-cases.md) ; cette page donne l'ordre, la
préparation et ce qu'il faut noter. Cocher au fur et à mesure, noter tout écart dans la colonne « Notes » ou à la fin.

## Préparation

**Personnes et comptes**
- [ ] Au moins **3 comptes Steam** avec CS2 : un admin (SteamID dans `GG_ADMIN_STEAMIDS`), un joueur de l'équipe
      Rouge, un joueur de l'équipe Noir. Idéalement un 4e compte **absent des rosters** (test de la whitelist).
- [ ] Un écran pour le site (admin) et, si possible, un 2e en navigation privée (vue spectateur).

**Stack**
- [ ] `make up-cs2` (serveur CS2 du conteneur), puis `make servers` : `srv-a` doit afficher « RCON connecté » et
      « logs reçus ».
- [ ] Les joueurs rejoignent depuis le réseau local : `connect <IP de la machine>:27015` (sous WSL, vérifier que le
      port est joignable depuis les autres PC).

**Tournoi de test**
- [ ] Créer un tournoi, deux équipes « Rouge » et « Noir », et mettre dans chaque roster le SteamID de son joueur
      (`POST /api/tournament/tournaments/:id/teams/:teamId/players`, capitaine = ce joueur).
- [ ] Un match bonus BO1 Rouge contre Noir pour les tests du moteur, et une série avec véto en mode de side « pick »
      pour RT-09 (`PUT /api/tournament/tournaments/:id/veto { mapPool, sideMode: "pick" }`).
- [ ] Format court pour aller vite au lancement : `settings: { mrFormat: 2, overtimeMrFormat: 1 }` (mi-temps au round 2,
      victoire à 3).

## 1. Site (sans jouer)

| # | À vérifier | OK | Notes |
|---|---|---|---|
| S-1 | `/login` : connexion Steam (admin) puis retour sur la page d'origine ; sans adresse d'origine, retour sur l'accueil `/` | [ ] | |
| S-2 | Barre du site : voyant « Direct » vert ; nom affiché ; « Tableau de bord » visible seulement pour un admin | [ ] | |
| S-3 | `/admin` en navigation privée : « Réservé aux admins » | [ ] | |
| S-4 | Accueil `/` : « En direct » vide puis le game apparaît au lancement (sans recharger), tournois listés | [ ] | |
| S-5 | Tableau de bord : game lancé (équipes, camps en couleur, score, map, phase), `srv-a` occupé, « mis à jour » qui avance | [ ] | |
| S-6 | Rendu sur tablette ou fenêtre étroite : rien ne déborde, tableaux lisibles | [ ] | |

## 2. Accès au serveur (RT-11)

| # | À vérifier | OK | Notes |
|---|---|---|---|
| A-1 | Page du match (`/view/matches/:id`) vue par le joueur Rouge connecté avec Steam : bouton « Se connecter » ; il rejoint sans taper le mot de passe | [ ] | |
| A-2 | Même page en privé (spectateur) : seulement « Regarder (GOTV) » ; la GOTV s'ouvre, en différé (~105 s) | [ ] | |
| A-3 | `connect <IP>:27015` sans mot de passe : refusé | [ ] | |
| A-4 | Le 4e compte (hors rosters) rejoint avec le mot de passe : kické « Vous n'êtes pas inscrit sur ce match », alerte dans le journal de la console | [ ] | |

## 3. Console de match

Ouvrir la console depuis le tableau de bord (clic sur le game). Garder un œil sur le chat en jeu et sur le journal.

| # | À vérifier | OK | Notes |
|---|---|---|---|
| C-1 | Journal : l'historique s'affiche à l'ouverture, puis les connexions, `!ready`, kills et rounds arrivent en direct | [ ] | |
| C-2 | Pause technique : le jeu se met en pause, « En pause technique » en ambre ; Reprendre : le jeu repart | [ ] | |
| C-3 | Message dans le jeu : affiché `[Admin] …` dans le chat, ligne « Admin … : message » au journal | [ ] | |
| C-4 | Échanger les camps en warmup : les joueurs changent de camp, les couleurs des équipes s'inversent à l'écran | [ ] | |
| C-5 | Forcer le départ en warmup (sans `!ready`) : décompte puis knife (ou live sans knife) | [ ] | |
| C-6 | Rejouer un round pendant le live (ex. round 2 au round 3) : confirmation demandée, le serveur revient au début du round, score et stats corrigés, serveur en pause ; Reprendre le serveur le relance | [ ] | |
| C-7 | Refus clairs : échanger les camps pendant le live, rejouer un round en warmup (bouton grisé ou message « refusé » avec la raison) | [ ] | |
| C-8 | Couper le réseau du PC admin quelques secondes : « Hors ligne » puis retour à « Direct » et reprise du journal | [ ] | |

## 4. Camps imposés par le véto (RT-09)

| # | À vérifier | OK | Notes |
|---|---|---|---|
| V-1 | Véto en mode « pick » (`/veto/:matchId`), puis lancement du game : pas de knife | [ ] | |
| V-2 | Un joueur dans le mauvais camp, les deux tapent `!ready` : pas de décompte, « Mauvais camp … À changer de camp : <pseudo> » | [ ] | |
| V-3 | Les deux équipes inversées, `!ready` : `mp_swapteams`, « Équipes inversées », décompte | [ ] | |
| V-4 | Noms d'équipe dans le scoreboard du jeu (TAB) du bon côté après le swap | [ ] | |

## 5. Moteur de match (RT-01 à RT-08)

| # | Test | OK | Notes |
|---|---|---|---|
| RT-01 | `!pause` après la pose de bombe : armée, appliquée au freeze suivant | [ ] | |
| RT-02 | `!tech` entre la fin du round et le freeze : armée puis appliquée | [ ] | |
| RT-03 | Rappel de la banque de pause : part de 120 s, jamais 0:00 | [ ] | |
| RT-04 | TAB pendant l'entracte de fin : écran de fin visible ~25 s, warmup seulement à +30 s | [ ] | |
| RT-05 | Rester connecté après la fin : kick à +120 s, GOTV et bots épargnés | [ ] | |
| RT-06 | Nouveau match lancé avant les 120 s : aucun kick | [ ] | |
| RT-07 | Démo GOTV du match (`playdemo`) : le dernier round est présent | [ ] | |
| RT-08 | Sandbox, replay « Round par round » : suivant / précédent / aller au round N cohérents | [ ] | |

## 6. Fin de match

| # | À vérifier | OK | Notes |
|---|---|---|---|
| F-1 | Score final enregistré : page du match et arbre mis à jour, game « auto (cs2) » | [ ] | |
| F-2 | Le game disparaît de « En direct » et `srv-a` redevient « libre » | [ ] | |

## Après la session

- Reporter les résultats dans `test-cases.md` (RT validés : déplacer dans « Validés », avec la date).
- Ouvrir une ligne dans `docs/context/todo.md` pour chaque écart trouvé.
- `make down` pour libérer la mémoire de WSL.
