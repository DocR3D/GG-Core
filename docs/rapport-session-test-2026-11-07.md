# Session de test du 2026-11-07

Une personne, un vrai serveur CS2 (conteneur `make up-cs2`, bots), le front Next (`GGCoreFront`, branche
`feat/migration-gg-core`) et des scripts qui jouent le rôle de l'équipe adverse (commandes de chat simulées sur le bus
Redis) et des rounds. Tout tournait sous WSL2 (Docker) : voir « Limites de l'environnement ».

Ce fichier résume ce qui a été **validé**, ce qui a été **trouvé et corrigé** (avec le pourquoi), ce qui **reste ouvert** et
ce qui n'a **pas pu être testé**.

## Validé

| Domaine | Détail |
|---|---|
| Site et connexion | login Steam (après correction), redirection des visiteurs vers la connexion, véto BO3 complet contre le bot |
| Accès au serveur | bouton « Se connecter » de la page du match (A-1), GOTV pour un visiteur (A-2) |
| Match réel | rounds, scores et raisons de fin de round, dont « temps écoulé » sur un vrai round avec un humain, mi-temps, prolongations, fin de match, score enregistré, serveur libéré |
| Console admin | pause, reprise, message, rejeu d'un round (avec pause ensuite), refus clairs, coupure réseau puis rattrapage |
| Pauses | RT-01 (vraie bombe), RT-02, RT-03 ; reprise par les joueurs (`!unpause` ou `!ready` des deux équipes) |
| Restauration | proposition d'un joueur, acceptation de l'adversaire, expiration, rejeu par un admin, restauration à travers la mi-temps |
| Fin de match | RT-04 (écran de fin), RT-05 (kick à +120 s), RT-06 (nouveau match avant le kick), RT-07 (démo complète) |

Validation finale (stack redémarrée avec toutes les corrections) : typecheck, lint (0 erreur), build, Jest (683 tests),
tests PostgreSQL (25), tests Go, `make e2e-tournament` (« all checks passed »), front : typecheck, build, lint (0 erreur
et 1 avertissement déjà présent, `legacy/lib/api.ts`).

## Défauts trouvés et corrigés

### Backend
- **Login Steam derrière le front** : le proxy Next réécrit `Host` en `backend:8081`, le retour Steam pointait vers le nom
  interne. `X-Forwarded-Host` est lu, mais seulement depuis un proxy de confiance (sinon un client choisirait où Steam
  renvoie le navigateur).
- **Restauration d'un round (`!restore`)** :
  - à l'expiration des 45 s : aucun message et le serveur restait en pause (la pause est posée à la proposition). Un
    minuteur annonce maintenant l'expiration et reprend ;
  - la pause de la proposition passe par le service de pause de GG-Core (pause technique « système ») : visible dans la
    console (« Reprendre »), `!unpause` fonctionne, armée en plein round et immédiate pendant le temps mort ;
  - `!backup` affichait cinq fois le score actuel : chaque point de reprise affiche le score qu'il restaure ;
  - décalage d'un round : `score.round` est le dernier round commencé, le round à rejouer est « rounds joués plus 1 » (aussi
    pour le bouton admin) ;
  - restauration **à travers la mi-temps** : le moteur gardait les camps échangés et la mi-temps « jouée » ; ils sont remis.
- **Frise des rounds** : le « round nul » que CS2 écrit au chargement d'un backup écrasait le vrai round ; il coupe
  maintenant les rounds suivants sans remplacer le vrai.
- **Console** : « Reprendre » efface une pause armée par un joueur ; après un rejeu admin, le match est mis en pause pour que
  l'admin vérifie ; 12 refus traduits en français.
- **Pauses** : messages avec le nom de l'équipe (plus « AWAY »), en français, sans durée annoncée qui n'est pas appliquée ;
  `!ready` pendant une pause vaut `!unpause` ; `!unpause` sans pause répond « Le match n'est pas en pause. ».
- **Fin de match** : `tv_stoprecord` partait au Game Over alors que la GOTV est retardée (105 à 120 s) : la démo perdait le
  dernier round (constaté en vrai). Arrêt à +125 s (`postgameDemoStopDelaySec`), intermission de 130 s
  (`mp_match_restart_delay`), réinitialisation à +135 s. Un nouveau match lancé entre-temps n'est pas touché.
- **Outil de test** : le simulateur de commandes de la Sandbox ne transmettait pas les paramètres (`!restore 4`).

### Front (GGCoreFront)
- le menu « trois points » de la page Tournois plantait (libellé de groupe hors de son groupe) ;
- colonnes du scoreboard en K D A comme en jeu ;
- boutons grisés de la console : infobulle au survol qui dit pourquoi ;
- après une coupure, la frise, le journal et le scoreboard ne rattrapaient pas ce qui était arrivé : ils se relisent à la
  reconnexion (console, page publique du match, Sandbox) ;
- libellé du « round nul » de restauration, plafond du round à rejouer, texte de confirmation du rejeu.

### Configuration
- `agent/cfg/ggbot/warmup.cfg` : `mp_endmatch_votenextmap 0` (le vote reste affiché mais inopérant) et
  `mp_match_restart_delay 130`.

## Reste ouvert

| Sujet | État |
|---|---|
| Un redémarrage du backend en plein match perd des événements (le flux `events_primary` n'est lu par personne) | connu, todo 12 ter ; confirmé en pratique |
| `GET /api/tournament/servers` répond sans connexion (IP, ports) | à trancher : public voulu ? |
| Kick post-match : CS2 n'affiche que « exclu par le serveur » | limite de CS2 ; piste : message dans le chat avant le kick |
| `overtime.cfg` remet `mp_overtime_maxrounds 6` | un format de prolongation non standard n'est pas respecté |
| Vote de la prochaine map toujours affiché | sans effet ; `mp_endmatch_votenextmap` vaut `false` sur le serveur |
| `snapshot.score.phase` reste « freeze » | champ trompeur, ne pas s'en servir comme phase du round |
| Événements du bus non relayés (`player_switched_team`, `pause:resumed`) | avertissement dans les logs, sans effet visible |
| Scoreboard : un joueur du roster pas connecté s'affiche avec son identifiant brut | basse |
| Proposition de restauration faite pendant une pause tactique : la banque n'est pas débitée des secondes écoulées | mineur |
| Alerte aux admins quand une pause technique dépasse 2 minutes | idée, todo 18 |
| Tests de bout en bout « scénario joué, journal comparé » | idée, todo 17 |
| Rechargement à chaud du backend en dev sous WSL | todo 16 |

## Limites de l'environnement
- **WSL2** : Windows ne relaie que le TCP vers `localhost`, alors que CS2 parle en UDP. Il faut l'IP de WSL
  (`PATCH /api/tournament/servers/:id {"ip":"<IP WSL>"}` pour que le bouton « Se connecter » marche). Pour des joueurs
  sur d'autres PC, Docker sous Linux natif est nécessaire. L'IP de WSL change à chaque redémarrage de WSL.
- `AUTH_PUBLIC_URL` n'est plus nécessaire derrière le front Next pour le login Steam.
- Les bots restent immobiles : les rounds se finissent par le temps (le CT gagne), et les prolongations ne finissent jamais
  (camps échangés à chaque mi-temps). Pour finir un match, il faut jouer, simuler ou intervenir en admin.

## Pas testé (deux humains, ou un autre PC, ou Internet)
- V-2 et V-3 : camps imposés par le véto (le contrôle ne juge pas tant qu'une équipe n'a aucun joueur placé) ;
- A-4 : refus d'un joueur hors roster (la liste blanche est désactivée quand un roster n'a pas de SteamID) ;
- scoreboard avec plusieurs vrais joueurs, véto avec deux capitaines sur deux navigateurs, login Steam sur un autre PC.
