#        GG-Core 

#  Cahier des charges

[**1\. Présentation générale	4**](#présentation-générale)

[b. Contexte du projet	4](#contexte-du-projet)

[c. Objectifs généraux	4](#objectifs-généraux)

[Automatiser la gestion des matchs	4](#automatiser-la-gestion-des-matchs)

[Centraliser la supervision des serveurs CS2.	4](#centraliser-la-supervision-des-serveurs-cs2.)

[Fournir une interface web unifiée	5](#fournir-une-interface-web-unifiée)

[Garantir la fiabilité et la résilience du système	5](#garantir-la-fiabilité-et-la-résilience-du-système)

[Préparer l’évolution vers un écosystème complet	5](#préparer-l’évolution-vers-un-écosystème-complet)

[d. Portée du projet (périmètre inclus/exclus)	6](#portée-du-projet-\(périmètre-inclus/exclus\))

[Périmètre inclus	6](#périmètre-inclus)

[Périmètre exclus	6](#périmètre-exclus)

[e. Parties prenantes et rôles	7](#parties-prenantes-et-rôles)

[Partie prenante	7](#partie-prenante)

[Rôle / Responsabilité principale	7](#rôle-/-responsabilité-principale)

[**2\. Description du besoin	8**](#description-du-besoin)

[b. Problématique à résoudre	8](#problématique-à-résoudre)

[c. Public cible / utilisateurs finaux	9](#public-cible-/-utilisateurs-finaux)

[d. Enjeux et critères de réussite	9](#enjeux-et-critères-de-réussite)

[Enjeux	9](#enjeux)

[Critères de réussite	9](#critères-de-réussite)

[e. Contraintes (techniques, performance, LAN sans Internet, etc.)	10](#contraintes-\(techniques,-performance,-lan-sans-internet,-etc.\))

[Contraintes techniques	10](#contraintes-techniques)

[**3\. Fonctionnalités attendues	11**](#fonctionnalités-attendues)

[b. Gestion des tournois et matchs	11](#gestion-des-tournois-et-matchs)

[c. Gestion des équipes et joueurs	12](#gestion-des-équipes-et-joueurs)

[d. Contrôle des serveurs (start, pause, knife, swap, overtime…)	13](#contrôle-des-serveurs-\(start,-pause,-knife,-swap,-overtime…\))

[e. Collecte et affichage des statistiques (kills, deaths, assists, %HS, economy, etc.)	14](#collecte-et-affichage-des-statistiques-\(kills,-deaths,-assists,-%hs,-economy,-etc.\))

[f. Système de pauses tactiques/techniques	16](#système-de-pauses-tactiques/techniques)

[Types de Pauses	16](#types-de-pauses)

[Fonctionnement Technique	16](#fonctionnement-technique)

[Critères de Réussite	17](#critères-de-réussite-1)

[g. Interface admin, joueur, publique	17](#interface-admin,-joueur,-publique)

[Interface Administrateur	17](#interface-administrateur)

[Interface Joueur	18](#interface-joueur)

[Interface Publique	18](#interface-publique)

[h. Export / historique des matchs	19](#export-/-historique-des-matchs)

[i. Évolutions possibles	20](#évolutions-possibles)

[j. Scénarios de validation	21](#scénarios-de-validation)

[**4\. Exigences techniques	22**](#exigences-techniques)

[a. Architecture logicielle	22](#architecture-logicielle)

[b. Communication inter-services	22](#communication-inter-services)

[c. Contraintes réseau	23](#contraintes-réseau)

[d. Sécurité et authentification	23](#sécurité-et-authentification)

[e. Persistance et sauvegarde	24](#persistance-et-sauvegarde)

[f. Déploiement et conteneurisation	24](#déploiement-et-conteneurisation)

[g. Observabilité et diagnostic	24](#observabilité-et-diagnostic)

[**5\. Interfaces et ergonomie	25**](#interfaces-et-ergonomie)

[a. Principes de conception	25](#principes-de-conception)

[b. Interface administrateur	25](#interface-administrateur-1)

[c. Interface publique	26](#interface-publique-1)

[d. Interface joueur (prévue v1.1)	26](#interface-joueur-1)

[e. Compatibilité et accessibilité	26](#compatibilité-et-accessibilité)

[f. Critères de réussite	26](#critères-de-réussite-2)

[**6\. Données et Stockage	27**](#données-et-stockage)

[a. Schéma de base de données	27](#schéma-de-base-de-données)

[c. Gestion du Temps Réel	27](#gestion-du-temps-réel)

[d. Volumétrie Estimée	27](#volumétrie-estimée)

[**7\. Exigences non fonctionnelles	29**](#exigences-non-fonctionnelles)

[a. Maintenabilité et extensibilité	29](#maintenabilité-et-extensibilité)

[c. Portabilité et déploiement	29](#portabilité-et-déploiement)

[d. Observabilité	29](#observabilité)

[e. Conformité et données	29](#conformité-et-données)

[g. Résilience aux erreurs	29](#résilience-aux-erreurs)

[**9\. Lexique étendu	30**](#lexique-étendu)

[**10\. Annexes	32**](#annexes)

[a. Schéma d’architecture en partant du serveur	32](#schéma-d’architecture-en-partant-du-serveur)

[b. Schéma d’architecture en partant du front end	33](#schéma-d’architecture-en-partant-du-front-end)

[c. Hierarchie du projet (https\://github.com/DocR3D/GG-Core) :	34](#heading=h.4yl51wjspo8s)

[Couche Adapters (I/O)	34](#heading=h.2mdh95kao0pd)

[Couche Application (use cases et services)	35](#heading=h.eat7zt3ygej9)

[Couche Domaine (contrats purs)	36](#heading=h.6n901giywb0s)

1. #  Présentation générale  {#présentation-générale}

   2. ## Contexte du projet {#contexte-du-projet}

Le projet **GG-Core** s’inscrit dans la continuité du célèbre outil **eBot** utilisé pour l’arbitrage et la gestion de matchs sur Counter-Strike.  
 

Les outils actuels de gestion de matchs sur Counter-Strike 2, tels que l’historique eBot, restent fonctionnels mais vieillissant et ne couvrent pas tout le périmètre d’une Lan.

L’objectif est donc de **reconstruire un nouveau gestionnaire de tournois** moderne, automatisé et performant, adapté aux contraintes actuelles :

* Fonctionnement sans plugin serveur pour ne pas impacter les performances des serveurs CS2.  
* Capacité à piloter et suivre plusieurs serveurs simultanément (jusqu’à 32).  
* Collecter en temps réel des logs et événements du jeu (kills, rounds, economy, pauses, etc.).  
* Interface web unifiée pour administrer et créer les matchs, suivre le score en direct et afficher les informations au public et aux joueurs.  
* Compatibilité LAN (fonctionnement hors ligne ou avec réseau local uniquement).  
* Compatibilité potentielle WAN

Le projet vise à répondre aux besoins d’organisation d’événements e-sport tels que les **GG-Lan à Brest**, où des matchs CS2 se déroulent simultanément, avec affichage des scores en direct, gestion fluide des pauses et redémarrages, et une centralisation des statistiques pour la communication post-événement.

3. ## Objectifs généraux {#objectifs-généraux}

### Automatiser la gestion des matchs {#automatiser-la-gestion-des-matchs}

* Création, planification et suivi des matchs.  
* Création et réalisation des vétos  
* Gestion automatique des phases de jeu : knife, swap, overtime, pauses tactiques et techniques.  
* Synchronisation des scores et statistiques en temps réel.

### Centraliser la supervision des serveurs CS2. {#centraliser-la-supervision-des-serveurs-cs2.}

* Piloter plusieurs serveurs via RCON.  
* Réception des logs HTTP pour collecter les événements du jeu.  
* Assurer un suivi stable 

### Fournir une interface web unifiée {#fournir-une-interface-web-unifiée}

* **Interface administrateur** : gestion des équipes, joueurs, tournois, et contrôle des serveurs.  
* **Interface publique** : affichage des scores, statistiques, et messages sponsorisés en direct.

### Garantir la fiabilité et la résilience du système {#garantir-la-fiabilité-et-la-résilience-du-système}

* Sauvegarde des données en base relationnelle pour l’historique et les replays.  
* Tolérance aux pannes : reprise automatique après crash d’un agent.

### Préparer l’évolution vers un écosystème complet {#préparer-l’évolution-vers-un-écosystème-complet}

* Extension possible vers la collecte de données CSTV (positions, grenades, heatmaps, replays 2D).  
* Intégration future avec un système de diffusion d’overlay pour le stream.  
* Possibilité d’ajouter des modules statistiques avancés (rating HLTV, clutch %, entry %, etc.).  
* Export des statistiques sous forme d’image.

  4. ## Portée du projet (périmètre inclus/exclus) {#portée-du-projet-(périmètre-inclus/exclus)}

### Périmètre inclus {#périmètre-inclus}

Le projet **GG-Core** couvre l’ensemble des éléments nécessaires à la gestion complète d’un tournoi Counter-Strike 2 :

**Gestion des entités de tournoi** :

* Tournois, équipes, joueurs, vétos, matchs et maps.

**Contrôle des serveurs de jeu** :

* Communication via RCON (start, restart, pause, swap, overtime, etc.).  
* Réception et parsing des logs HTTP envoyés par CS2.

**Verrouillage des accès**

* Chaque match est **protégé par un mot de passe unique obligatoire**, généré automatiquement lors de sa création.  
* Une **whitelist SteamID** peut être activée en complément pour vérifier que seuls les joueurs autorisés rejoignent le serveur ou pour exclure certains profils.  
* L’interface joueur propose un bouton **« Se connecter »** qui applique automatiquement le mot de passe du match.

**Collecte et traitement des données de match** :

* Kills, assists, deaths, score, économie, round states, pauses, phases de jeu.  
* Agrégation des statistiques simples par joueur, équipe et tournoi.

**Architecture temps réel et centralisée** :

* Redis pour le dispatch d’événements.  
* Base de données pour la persistance et l’historique.

**Interfaces web** :

* **Admin** : création et gestion des tournois, équipes, serveurs et matchs.  
* **Public** : affichage live des scores, stats et messages sponsorisés.

**Déploiement simplifié** :

* Fonctionnement via Docker Compose, sur LAN ou Internet.  
* Support multi-serveurs (jusqu’à 32/64 simultanés).

### Périmètre exclus {#périmètre-exclus}

Certaines fonctionnalités ne font pas partie du périmètre initial du projet :

**fournir des overlays** des streams

**Replay 2D ou viewer interactif Live** (prévu dans une phase ultérieure via CSTV).

**Collecte et traitement des données compliqué de match** :

* Eco Kill, nombre de dégâts par round, Entry kill

  5. ## Parties prenantes et rôles  {#parties-prenantes-et-rôles}

| Partie prenante | Rôle / Responsabilité principale |
| :---- | :---- |
| **Équipe technique GG-Core** | Conception, développement et maintenance du système complet (backend, frontend, agents Go, infrastructure). |
| **Administrateurs de tournoi (CS Admins)** | Utilisateurs principaux de l’interface admin. Gèrent les matchs, les vétos, les pauses, les swaps et les scores pendant l’événement. |
| **Spectateurs / Public LAN** | Consultent les résultats, scores et statistiques en direct via l’interface publique. |
| **Joueurs** | Interagissent indirectement via les serveurs CS2 (leurs actions génèrent les événements collectés par GG-Core). E |
| **Administrateur système** | Déploie et maintient l’infrastructure (serveurs Docker, Redis, PostgreSQL, agents Go, réseau LAN). |

     ## 

2. #  Description du besoin {#description-du-besoin}

Cette partie décrit la problématique à résoudre, les utilisateurs visés et les contraintes identifiées. Elle précise pourquoi le projet est nécessaire et sur quels critères son succès sera évalué.

2. ## Problématique à résoudre {#problématique-à-résoudre}

Les outils actuels de gestion de matchs sur Counter-Strike 2, tels que l’historique eBot, restent fonctionnels via le protocole logaddress\_add, mais présentent plusieurs limites :

* Architecture vieillissante (plus de dix ans) difficile à maintenir et à faire évoluer;  
  technologies obsolètes, non adaptées à une architecture distribuée moderne;  
* Écosystème fragmenté : plusieurs outils sont nécessaires pour gérer les matchs, les serveurs, les statistiques et les overlays ;  
* Absence de fonctionnalités clés comme la création automatique d’arbre ou de poules, la gestion des vétos de maps;  
* Impossibilité d’exploiter des sources de données avancées comme CSTV pour la capture des positions, grenades et replays.

Dans ce contexte, GG-Core vise à proposer une solution complète, unifiée et moderne, capable de gérer à la fois le pilotage des serveurs, la gestion des tournois, et la collecte de données temps réel, tout en préparant le système à des fonctionnalités avancées futures basées sur CSTV.

Les organisateurs doivent pouvoir gérer la totalité du cycle de tournoi, depuis les inscriptions jusqu’à la finale :

* Création automatique des poules et arbres ;  
* Configuration et réalisation des vétos de maps ;  
* Génération automatique des matchs à partir des résultats ;  
* Affichage pour chaque joueur de sa page personnelle (prochain match, heure, serveur).

  3. ## Public cible / utilisateurs finaux {#public-cible-/-utilisateurs-finaux}

| Utilisateur | Besoin principal | Usage du système |
| :---- | :---- | :---- |
| Administrateurs de tournoi | Gérer les matchs, les vétos, les serveurs et les équipes depuis une interface unique | Utilisent l’interface **admin** pour créer, lancer, mettre en pause ou clôturer les matchs, suivre les scores et gérer les situations spéciales (swap, overtime, veto, etc.) |
| Joueurs | Participer aux matchs dans un environnement fluide et équitable | Interagissent indirectement via les serveurs CS2 ; leurs actions génèrent les données collectées par GG-Core |
| Spectateurs et public LAN | Suivre les scores et statistiques en direct | Accèdent à la **page publique** de suivi live et aux résumés post-match |

  4. ## Enjeux et critères de réussite  {#enjeux-et-critères-de-réussite}

### Enjeux {#enjeux}

* **Modernisation de l'infrastructure :** Mettre à jour la gestion des tournois e-sport CS2 avec des technologies récentes, maintenables et extensibles.  
* **Centralisation des opérations :** Regrouper toutes les fonctionnalités d'un tournoi (gestion des matchs, serveurs, statistiques, affichage) en un seul outil.  
* **Optimisation des tournois LAN :** Réduire les temps d'attente et les erreurs humaines, et assurer une reprise rapide en cas d'incident.  
* **Préparation à l'avenir :** Permettre l'intégration future de données CSTV (trajectoires, heatmaps, replays).  
* **Amélioration de la visibilité :** Diffuser les scores et statistiques en direct pour le public.

### Critères de réussite {#critères-de-réussite}

* **Gestion des matchs :** Tous les matchs doivent être gérés et suivis via l'interface web, sans intervention manuelle sur les serveurs.  
* **Stabilité du système :** Le système doit rester stable sur au moins 32 serveurs simultanés.  
* **Fonctionnement hors ligne :** Le tournoi complet doit pouvoir être organisé en LAN sans connexion Internet.  
* **Accessibilité des administrateurs :** Les administrateurs ne doivent pas avoir besoin de plugins SourceMod ni d'accès direct au serveur.  
* **Fiabilité des données :** Le système doit enregistrer 100 % des rounds et kills, sans aucune perte de données.


  5. ## Contraintes (techniques, performance, LAN sans Internet, etc.) {#contraintes-(techniques,-performance,-lan-sans-internet,-etc.)}

## **Contraintes techniques** {#contraintes-techniques}

* **Aucune dépendance serveur :** interdiction d’utiliser SourceMod ou tout plugin tiers pour ne pas altérer les performances CS2.  
* **Compatibilité LAN :** le système doit fonctionner sans Internet, en environnement isolé, avec uniquement le réseau local.  
* **Communication standardisée :** Les agents utilisent RCON et logaddress\_add\_http comme seules interfaces de communication avec CS2.  
* **Faible latence :** les données doivent être traitées et affichées en temps réel.  
* **Tolérance aux pannes :** un crash d’agent ou du backend ne doit pas nécessiter de redémarrage manuel des serveurs CS2. De la même manière, un crash d’agent doit être indépendant des autres agents.  
* **Scalabilité locale :** gestion simultanée d’au moins 32 serveurs sur un même orchestrateur.  
* **Architecture conteneurisée :** tout doit être exécutable sous Docker Compose pour faciliter le déploiement.

**Contraintes organisationnelles**

* Déploiement rapide et reproductible avant chaque LAN (setup complet \< 15 min).  
* Interfaces accessibles et compréhensibles par les administrateurs non techniques.  
* Compatibilité avec les configurations existantes du site d’inscription des équipes.

**Contraintes d’évolution**

* Prévoir une intégration CSTV future (position, grenades, replays).  
* Prévoir la possibilité de proposer dans le futur un overlay pour afficher sur les streams  
* Maintenir un socle technologique moderne : Go, NestJS, Redis, PostgreSQL, React. (décision du 2026-10-31 : React + Vite servi par NestJS au lieu de Next.js, voir `docs/context/frontend.md`)  
* Respect des normes de sécurité réseau (auth, JWT, isolation des services).

3. # Fonctionnalités attendues {#fonctionnalités-attendues}

Cette section présente les principales fonctions que doit assurer GG-Core pour garantir la gestion complète d’un tournoi CS2, depuis la création des matchs jusqu’à la visualisation publique des scores et statistiques.

2. ## Gestion des tournois et matchs  {#gestion-des-tournois-et-matchs}

GG-Core doit permettre une **gestion complète et centralisée** des tournois de Counter-Strike 2, depuis la configuration initiale jusqu’à la fin du dernier match.

**Création de tournoi** :

* Nom, description, type (simple élimination, double élimination, poules, etc.).  
* Configuration générale (format MR12, overtime, maps disponibles, nombre de serveurs).

**Gestion des poules et arbres** :

* Création automatique ou manuelle des groupes à partir de l’api FaceIt si disponible.  
* Génération d’un arbre à partir des résultats des poules.  
* Mise à jour automatique des brackets en fonction des résultats.

**Création et affectation des matchs** :

* Réalisation des vétos en ligne depuis l’interface admin, intégrée au déroulement du match avant le démarrage serveur.  
* Lien entre équipes, maps et serveur CS2 assigné.  
* Suivi de l’état du match : *à venir / en cours / terminé / en pause*.  
* Historique des actions (swap, restart, pause, etc.).

**Verrouillage des accès :**

* Accès protégé par **whitelist SteamID** pour assurer que seuls les joueurs inscrits puissent rejoindre le serveur.  
* Mot de passe unique généré à la création du match (utile si SteamID non disponible).  
* L’interface joueur propose un bouton « Se connecter » qui applique automatiquement la méthode d’accès (SteamID et/ou mot de passe) selon la configuration du match.

**Paramétrage des règles** :

* Choix du nombre de rounds, du format MR12, MR15 ou MR3 (Overtime).  
* Activation des prolongations et configuration du système d’économie.  
* Paramètres spécifiques LAN (timeouts, messages sponsorisés, etc.)

**Source de vérité et reconstitution d’état** :

* Toutes les actions et événements sont enregistrés dans une timeline d’événements normalisée (Redis \+ PostgreSQL).  
* Cette timeline permet de reconstruire l’état complet d’un match à n’importe quel instant (snapshot) et de pouvoir retirer des actions qui ne seraient pas vraiment arrivées.

Objectif : pouvoir sauvegarder, restaurer ou rejouer un match sans perte de cohérence.

**Suivi en temps réel** :

* Mise à jour du score et des rounds via WebSocket.  
* Affichage des événements clés (round start/end, kills, bombes, pauses).  
* Synchronisation automatique avec le front public et les overlays.

**Archivage et historique** :

* Sauvegarde des résultats et statistiques de chaque match.  
* Export JSON/CSV ou affichage rétrospectif des données.

  3. ## Gestion des équipes et joueurs {#gestion-des-équipes-et-joueurs}

GG-Core est conçu pour être la colonne vertébrale des tournois, garantissant une gestion fluide et cohérente des équipes et des joueurs. Il assure une intégration parfaite entre les données d'inscription, les serveurs CS2 et la collecte de statistiques.

**Gestion des Équipes :**

* Créez, modifiez et supprimez des équipes.  
* Associez des informations détaillées : nom, tag, logo, photo.  
* Affectation intelligente aux poules et arbres de tournoi, manuelle ou automatique.

**Gestion des Joueurs :**

* Créez et éditez des profils joueurs complets (nom, pseudo, SteamID64, FaceItID).  
* Attribuez les joueurs aux équipes.  
* Liaison automatique et instantanée entre SteamID et les statistiques de jeu.

**Synchronisation Serveur Avancée :**

**Liaison d’identité :** les SteamID sont utilisés pour valider l’appartenance d’un joueur à un match (whitelist) et pour agréger les statistiques. Si SteamID indisponible, l’authentification par mot de passe est utilisée comme secours.

**Statistiques Individuelles Approfondies :**

* Suivi détaillé des performances : kills, deaths, assists, HS%, K/D, ADR, clutchs, etc.  
* Agrégation automatique et intuitive des données par match, par carte et par tournoi.

**Expérience Utilisateur Optimale :**

* Affichage des équipes et rosters sur l'interface publique.  
* Présentation claire et simplifiée des comparaisons d'équipes (rating, etc.).

**Données Joueurs Unifiées et Centralisées :**

* Chaque joueur bénéficie d'un identifiant interne unique.  
* Toutes les données (matchs, statistiques, line-ups, événements) sont reliées à cet identifiant.  
* Permet une historisation globale et une analyse transversale sur l'ensemble des tournois.

  4. ## Contrôle des serveurs (start, pause, knife, swap, overtime…) {#contrôle-des-serveurs-(start,-pause,-knife,-swap,-overtime…)}

**Pilotage et orchestration**

* **Affectation serveur** : sélection auto/manuelle, contrôle d’un ou plusieurs serveurs en parallèle.  
* **Démarrage match** : warmup, chargement map, config tournoi, vérifications préalables (slots, GOTV, convars clés).  
* **Queue de commandes RCON** : ordonnancement, retry, timeout, idempotence, rate-limit.  
* **Journal d’actions** : chaque commande est horodatée, corrélée au match et au serveur.

**Phases de jeu**

* **Knife round** : lancement, détection du vainqueur (simple ou détaillé), choix de side, application du swap.  
* **Swap de sides** : mapping logique↔physique robuste, messages auto, vérifications score.  
* **Overtime** : activation conditionnelle, économie et paramètres dédiés, cycles successifs.

**Pauses et reprises**

* **Pause tactique** : banque par équipe, compteur de secondes restantes, affichage live, auto-unpause à l’expiration.  
* **Pause technique** : sans banque, envoie une notification aux admins.  
* **Règles** : armement de pause à la prochaine phase d’achat, messages périodiques “time left”, anti-abus.

**Verrouillage des accès**

* **Roster enforcement** : whitelist par mot de passe ou par steamID avec la possibilité aux joueurs de se connecter via un bouton sur leur interface.

**Gestion de map et config**

* **Changement de map** : say \+ countdown, sauvegarde d’état.  
* **Templates de config** : LAN, knife, warmup, BO1/BO3, MR12/MR15, overtime on/off, overtime, presets sponsors/messages.

**Sécurité et robustesse**

* **Healthchecks** : heartbeat agent ↔ serveur, détection crash ou freeze.  
* **Reprise** : re-attach après redémarrage agent/backend, resynchronisation snapshot. Mise en file dans l’agent les logs si le backend crash pour tout rattraper au redémarrage 

**Observabilité**

* **Logs structurés** : commandes envoyées, réponses RCON, événements clés.  
* **Événements temps réel** : match:state, round:start/end, pause:update, sides:swapped, score:update.

**Critères d’acceptation**

* Pause tactique avec **auto-unpause** fiable et message “N secondes restantes”.  
* Overtime activé automatiquement à égalité selon le format défini.  
* Toute commande RCON confirmée ou réessayée, jamais exécutée deux fois.  
* Reconnexion agent/backend sans perte de contrôle ni d’événements.

  5. ## Collecte et affichage des statistiques (kills, deaths, assists, %HS, economy, etc.) {#collecte-et-affichage-des-statistiques-(kills,-deaths,-assists,-%hs,-economy,-etc.)}

**Collecte de données :**

* **Source Principale :** Logs HTTP envoyés par `logaddress_add_http`.  
* **Événements Suivis :**  
  * Kills (arme, tir à la tête, équipe)  
  * Assists, deaths (potentiellement dégâts)  
  * Pose/désamorçage de bombe  
  * Début/fin de round  
  * Pauses, changements d'équipes, prolongations  
  * Commandes de chat (`!pause`, `!ready`, etc.)  
* **Validation et Parsing :** Normalisation via expressions régulières, puis publication dans Redis (clé : `ggcore:events:primary`).  
* **Alignement Temporel :** Horodatage précis (tick \+ timestamp) pour assurer la cohérence entre les serveurs.

**Traitement en Temps Réel :**

* **Redis** sert de bus central, publiant chaque événement vers les consommateurs (backend, *stats worker*).  
* **Backend NestJS :**  
  * Enregistre les événements primaires (kills, rounds, économie).  
  * Met à jour les projections (scoreboard joueur/équipe, round courant, économie).  
* **Mise à Jour de l'UI :** Via WebSocket (événements `score:update`, `kill`, `round:end`).

**Statistiques Calculées :**

* **Individuelles :** Kills, deaths, assists, HS%, K/D, ADR, rating HLTV 1.0+/2.0 (selon les données disponibles), *entry kills*, *clutches*.  
* **Par Équipe :** Rounds CT/T, *winrate*, succès éco, poses de bombe, désamorsages, bonus économiques.  
* **Tournoi :** Classement général, meilleurs joueurs par catégorie, meilleure équipe par catégorie, vaincqueur.

**Affichage :**

* **Interface Publique :**  
  * Scoreboard en direct par match.  
  * Graphiques simples (round-par-round, top kills).  
  * Fiche joueur consultable avec statistiques cumulées.  
* **Interface Joueur :**   
  * Affichage des prochains matchs  
  * Affichage des détails des matchs à venir  
  * Notification quand un match est prêt avec un bouton pour se connecter  
* **Interface Admin :**  
  * Vue synthétique des scores \+ détails des rounds.  
  * Historiques des événements.

**Fiabilité et Reprise :**

* Tous les événements sont horodatés et persistés (source de vérité).  
* En cas de crash, le snapshot Redis \+ l'historique Postgres permettent de **rejouer les événements** pour reconstituer un match complet.  
* Les pertes de connexion temporaires (agent ↔ backend) n'entraînent aucune suppression de données.


  6. ##  Système de pauses tactiques/techniques {#système-de-pauses-tactiques/techniques}

GG-Core intégrera un système de pauses automatisé, fiable et transparent, conforme aux règles e-sport tout en étant adapté aux environnements LAN.

### Types de Pauses {#types-de-pauses}

* **Pause Tactique**  
  * Déclenchement : Par une équipe via commande en jeu (ex: `!pause`, `!tac`)  
  * Durée : Limitée (ex: 5 minutes par match) avec un compteur visible.  
  * Fin : Annulation automatique (auto-unpause) à la fin du compte à rebours ou via commande en jeu (ex: `!unpause)` ou intervention admin.  
* **Pause Technique**  
  * Déclenchement : Par une équipe via commande en jeu (ex: `!tech`, `!admin`)  (pour problèmes matériels, réseau, etc.) ou depuis l'interface administrateur.  
  * Durée : Illimitée jusqu'à reprise manuelle par un administrateur ou via commande en jeu (ex: `!unpause)`.  
  * Affichage : État visible sur l'interface publique et enregistré dans les logs.  
  * Notification envoyé sur Discord ou sur le site

### Fonctionnement Technique {#fonctionnement-technique}

* **Système d'Armement**  
  * Une pause demandée est "armée" et se déclenche au début de la prochaine "freeze time" pour éviter d'interrompre les rounds actifs.  
* **Banque de Pauses**  
  * Chaque équipe dispose d'un compteur individuel de pauses tactiques restantes.  
  * Stockage : Redis pour l'opérationnel, PostgreSQL pour la persistance et la cohérence post-redémarrage.  
* **Gestion du Temps**  
  * Le minuteur est géré côté backend, indépendamment du serveur de jeu.  
  * Communication : Des événements `pause:update` sont émis chaque seconde via WebSocket pour synchroniser le frontend et les overlays.  
  * Fin : L'auto-unpause se déclenche à l'expiration du minuteur.  
* **Affichage et Communication**  
  * Message automatique dans le chat du serveur de jeu (ex: "Pause tactique \- Team A (30 sec restantes)").  
  * Compteur visible sur les interfaces admin et publiques.  
  * Notification sonore optionnelle pour les administrateurs.  
* **Résilience**  
  * En cas de redémarrage d'un agent ou du backend pendant une pause, le système reprend le minuteur restant.  
  * Un snapshot Redis assure la continuité de l'état des pauses.

### Critères de Réussite {#critères-de-réussite-1}

* Aucune pause ne doit se déclencher pendant un round actif.  
* Le minuteur tactique doit être précis à ±5 secondes.  
* L'auto-unpause doit fonctionner sans intervention manuelle.  
* Les administrateurs doivent pouvoir reprendre un match à tout moment sans désynchronisation.  
* L'état de la pause doit rester cohérent entre le serveur de jeu, le backend et le frontend.

  7. ## Interface admin, joueur, publique  {#interface-admin,-joueur,-publique}

### Interface Administrateur {#interface-administrateur}

L'outil principal pour les arbitres et organisateurs de LAN, offrant un contrôle complet du tournoi sans interaction directe avec les serveurs CS2.

**Fonctionnalités Clés :**

**Tableau de Bord Administrateur**

* Créer un nouveau tournois  
* Modifier un tournois (Forcer le passage en arbre, changer le format)

**Tableau de Bord du Tournoi**

* Vue d'ensemble des tournois, matchs, équipes et serveurs actifs.  
* Statut en temps réel : *en cours / terminé / en attente / en pause / En retard*.

**Console de Match**

* Commandes directes (démarrer, redémarrer, pause, reprendre, échanger, changer de carte, restaurer).  
* Flux d'événements en temps réel (rounds, éliminations, messages de chat).  
* Contrôle manuel du tableau des scores pour d'éventuelles corrections.

**Gestion des Entités**

* Création et édition des équipes, joueurs, matchs et serveurs.  
* Attribution automatique ou manuelle des serveurs aux matchs.  
* Visualisation de la composition et verrouillage par SteamID.

**Gestion des Sponsors et Affichage Public**

* Ajout et modification de messages sponsorisés à afficher dans le chat ingame.  
* Rotation manuelle ou automatique des messages.

**Journaux et Statistiques**

* Historique détaillé de chaque match (chronologie, statistiques agrégées).

**Exigences Techniques**

* Authentification JWT avec gestion des rôles (administrateur / personnel / spectateur).  
* Interface réactive, optimisée pour tablette et ordinateur portable.  
* Reconnexion automatique aux WebSockets en cas de perte réseau.

### Interface Joueur {#interface-joueur}

Offrir aux joueurs un espace minimaliste pour s'identifier, consulter leur emploi du temps, recevoir des notifications en cas de match prêt, avoir un bouton pour faciliter la connexion et afficher leur statistiques.

**Identification**

* Liaison SteamID (lecture seule)

**Centre de match**

* Affichage de l'heure, du serveur et de la carte  
* Notifications en temps réel des changements d'horaire.  
* Notification quand le match est prêt à être rejoint avec un bouton pour lancer la connexion

**Vérifications de cohérence (Sanity checks)**

* **Vérification d’accès :** l’interface affiche une alerte si le SteamID du joueur n’est pas présent dans la whitelist du match.

**Exigences Techniques**

* Rôles "joueur" distincts des administrateurs  
* Authentification LAN légère, sans dépendance externe (avoir une alternative au steamID en cas de perte de connexion internet)  
* Lecture des données en temps réel via WebSocket, sans commandes serveur

###  Interface Publique {#interface-publique}

Conçue pour les spectateurs sur place et à distance, ou pour les joueurs souhaitant voir des informations concernant les matchs des autres équipes. Il doit offrir un affichage clair, réactif et sans latence perceptible.

**Page "Match en Direct"**

* Tableau des scores complet : équipes, scores, rounds, phase actuelle.  
* Statistiques détaillées des joueurs (K/D/A, % Tête, ADR).  
* Chronomètre de round et état de la bombe (posée, désamorcée, explosée).  
* Messages sponsorisés dynamiques dans le chat in-game.

**Page "Tournoi"**

* Liste des matchs en cours et terminés.  
* Accès direct à la page live de chaque match.  
* Classements et statistiques globales.

**Page "Équipe / Joueur"**

* Profil avec historique des matchs et statistiques cumulées.

**Exigences Techniques**

* Synchronisation WebSocket en temps réel.  
* Mode plein écran sans rechargement de page.  
* Design réactif et lisible sur grands écrans.

**Critères de Réussite**

* L'interface administrateur doit être capable de piloter un match complet sans recours à la console serveur.  
* La navigation doit être fluide et sans rafraîchissement.  
* L'authentification et les rôles doivent être fonctionnels, empêchant tout accès public aux commandes critiques.

  8. ## Export / historique des matchs {#export-/-historique-des-matchs}

Le module GG-Core est conçu pour assurer la persistance et la consultation des données de matchs, rounds et événements.

**Archivage Automatique et Fidélité des Données**

À l'issue de chaque match, le backend procède à une sauvegarde exhaustive des informations suivantes :

* Scores finaux  
* Statistiques détaillées des joueurs et équipes  
* Chronologie complète des événements (éliminations, pauses, remplacements, etc.)  
* Économie par round  
* Configuration précise du match (carte, équipes, serveurs, version du jeu)

Toutes ces données sont stockées de manière fiable dans **PostgreSQL**, constituant ainsi une vérité historique inaltérable et exportable via l'interface d'administration. La capacité de rejouer ou de reconstruire un match à partir de sa chronologie est une fonctionnalité clé, garantissant l'intégrité de la vérité historique.

**Consultation Intuitive des Données**

**Interface Administrateur :**

* Liste complète des matchs passés, enrichie de filtres avancés (tournoi, équipe, carte, date) pour une recherche aisée.  
* Vue détaillée de chaque match : tableau des scores finaux, statistiques approfondies et historique round par round.

**Interface Publique :**

* Résumés synthétiques des matchs : score, meilleur joueur, date et carte jouée, offrant une vue rapide et pertinente.  
* Visualisation des statistiques globales d'un tournoi, permettant une analyse macroscopique des performances.

**Critères de Réussite Essentiels**

* Garantie d'aucune perte de données de match, même après un redémarrage du backend.  
* L'historique complet d'un tournoi doit rester intégralement consultable et rejouable.

  9. ## Évolutions possibles {#évolutions-possibles}

L'objectif de ce sous-chapitre est de lister les fonctionnalités ou extensions envisagées à moyen ou long terme. Bien que non incluses dans la première version, ces anticipations visent à orienter la conception technique du projet.

**CSTV (Counter-Strike TV+) :**

* Collecte des positions, trajectoires de grenades et replays.  
* Génération de replays 2D interactifs sur mini-carte.

**Export :**

* Formats JSON/CSV pour publication post-LAN ou archivage.  
* Création automatique de fiches joueurs et équipes au format image (pour publication sur les réseaux sociaux).  
* Export infographique de tableaux de scores ou de statistiques.

**Overlays stream avancés :**

* API WebSocket pour une intégration directe dans OBS/XSplit.  
* Gestion dynamique des sponsors, transitions et animations.

**Statistiques enrichies :**

* Calculs de Rating HLTV 3.0, clutch%, entry%, trade ratio.  
* Analyse comparative entre joueurs ou équipes.

**Module de planning et gestion complète des tournois :**

* Gestion automatique des horaires, retards et notifications administrateur.

**Système de replay global :**

* Archivage automatique des démos GOTV.  
* Visionneuse interne ou export vers un visualiseur externe.

  10. ## Scénarios de validation {#scénarios-de-validation}

* Lancer un tournoi de 10 serveurs simultanés sans perte d’événements.  
* Redémarrer le backend : reprise des matchs en cours depuis snapshots.  
* Tester une pause tactique et vérifier auto-unpause à la fin de la banque.  
* Simuler crash agent : reconnexion sans perte de contrôle.  
* Simuler crash server CS : création de fichier backup à partir de la snapshot

4. # Exigences techniques {#exigences-techniques}

Ce chapitre détaille les fondations techniques du projet, incluant les composants principaux, la communication inter-services, et les exigences non fonctionnelles (performance, sécurité, résilience).

1. ## Architecture logicielle {#architecture-logicielle}

**Architecture distribuée composée de cinq blocs :**

* **Agents Go** : Les agents exécutent les commandes RCON reçues via Redis et publient les logs HTTP de CS2.  
* **Backend NestJS** : Logique métier, API REST, WebSocket, synchronisation.  
* **Redis** : Bus de messages temps réel (Pub/Sub) et cache.  
* **PostgreSQL** : Persistance longue durée (vérité historique).  
* **Frontend React** : Interface d'administration et interface publique. (décision du 2026-10-31 : React + Vite servi par NestJS au lieu de Next.js, voir `docs/context/frontend.md`).

**Flux de données**

* Frontend (Admin) → Backend NestJS → Redis → Agent Go → Serveur CS2 → Agent Go → Redis → Backend → Frontend (Public/Admin).  (Voir annexe)  
* Sauvegarde parallèle des événements vers PostgreSQL.

**Philosophie**

* L'événement est l'unité centrale.  
* Les snapshots sont reconstruits à partir des événements (pattern event sourcing).  
* Chaque module est indépendant et tolérant aux pannes.

  2. ## Communication inter-services {#communication-inter-services}

**RCON** : Commandes vers les serveurs CS2 (start, pause, restart, etc.).

**HTTP Logs** : Les agents reçoivent des logs via `logaddress_add_http` et les renvoient sous formes d'événement sur Redis.

**Redis (Pub/Sub)** : Distribution des événements normalisés.

**HTTP REST API (NestJS)** :

* Gestion du tournoi, des équipes et des serveurs.  
* Endpoints publics : `/api/matches/:id`, `/api/teams`, etc.

**WebSocket (Socket.IO)** : Diffusion temps réel vers le frontend.

3. ## Contraintes réseau {#contraintes-réseau}

**Fonctionnement LAN-first** : Aucun service ne dépend d'Internet.

**Compatibilité IPv4/IPv6**.

**Ports standards** :

* RCON : 27015/tcp  
* GOTV : 27020/udp (optionnel)  
* Backend HTTP : 8081  
* Redis : 6379  
* Postgres : 5432

  4. ## Sécurité et authentification {#sécurité-et-authentification}

**Contrôle d’accès principal :** chaque match possède un mot de passe unique obligatoire, régénéré à chaque création.

**Contrôle d’accès complémentaire :** une whitelist SteamID optionnelle peut être utilisée pour restreindre ou bloquer certains joueurs.

**Interface joueur :** le bouton « Se connecter » applique automatiquement le mot de passe du match.

**Sécurité générale :** rotation des secrets JWT et RCON, whitelists IP sur `/cs2/logs`, et non-exposition de Redis/Postgres en dehors du LAN.

**Authentification JWT** avec rôles (admin / joueur/ publique).

**Séparation réseau** : Redis et PostgreSQL non exposés publiquement.

**Chiffrement HTTPS** pour toutes les interfaces web externes.

**Validation stricte des payloads** côté API.

**Logs d’accès** et **Journalisation** des actions critiques (pause, restart, unpause).

**Durcissement en entrée** : validation stricte schémas, rate-limit RCON/HTTP.

**Whitelist IP** pour envoyer des logs sur `/cs2/logs`.

**Secret RCON** unique par serveur, régénéré avant chaque LAN.

**Rotation mensuelle des JWT** secrets.

**Limitation du nombre de requêtes RCON** par seconde.

5. ## Persistance et sauvegarde {#persistance-et-sauvegarde}

**Redis** : Cache et file d’événements actifs (durée de vie limitée).

**PostgreSQL** : Vérité historique persistante (événements, entités, snapshots).

**Sauvegardes automatiques** : Dump quotidien de la base et persistance des volumes Docker.

**Reconstruction d’état** : Possibilité de restaurer un match à partir des événements stockés.

6. ## Déploiement et conteneurisation {#déploiement-et-conteneurisation}

**Docker Compose** : Exécution des services (agent, backend, redis, postgres ; le frontend est compilé et servi par le backend).

**Volumes persistants** pour Redis et PostgreSQL.

**Configuration réseau** : Bridge Docker isolé, sous-réseaux distincts par environnement (LAN / prod).

**Logs centralisés** : Sortie standard \+ fichiers de rotation (format JSON).

7. ##  Observabilité et diagnostic {#observabilité-et-diagnostic}

**Metrics internes** : Latence, TPS, nombre d’événements traités, erreurs RCON.

**Healthchecks** sur tous les services (`/health` endpoint).

**Alerting** simple (Redis TTL, heartbeats agents).

**Logs structurés** : Horodatage, type, `matchId`, `serveurId`, niveau (info/warn/error).

5. # Interfaces et ergonomie {#interfaces-et-ergonomie}

GG-Core est conçu pour offrir des interfaces utilisateur claires, réactives et cohérentes. Optimisées pour une utilisation en réseau local (LAN).

1. ## Principes de conception {#principes-de-conception}

**Lisibilité immédiate** : Les informations cruciales (score, round, timer, état de pause) sont mises en avant pour une compréhension instantanée.

**Action rapide** : Les commandes essentielles sont directement accessibles, éliminant le besoin de navigations complexes.

**Retour visuel systématique** : Chaque interaction (pause, échange d'équipes, redémarrage) génère un feedback visuel instantané et explicite.

**Uniformité visuelle** : Une charte graphique cohérente assure une expérience unifiée sur les interfaces administrateur, publique et joueur.

**Mode clair/sombre adaptatif** : L'interface s'adapte à l'environnement d'utilisation (salle LAN, scène d'événement, bureau).

**Ergonomie “LAN”** : Des boutons larges, des raccourcis clavier intuitifs et une compatibilité tactile (tablette) garantissent une manipulation aisée.

2. ## Interface administrateur {#interface-administrateur-1}

**Tableau de bord global** : Une vue synthétique de l'ensemble des tournois, des matchs, des serveurs et de leurs statuts.

**Console de match** : Un espace de contrôle dédié affichant les logs en temps réel, le tableau des scores et des boutons d'action instantanés (pause, échange d'équipes, redémarrage).

**Vue tournoi** : Une arborescence claire des poules et des phases finales avec une progression automatique.

**Vue statistiques** : Des graphiques détaillés par équipe, joueur et carte pour une analyse approfondie.

**Exigences UX :**

* **Navigation fluide** : Pas de rechargement de page grâce à une application React (routage côté navigateur) et aux WebSockets.  
* **État visuel clair** : Un code couleur intuitif pour indiquer les statuts (vert \= actif, orange \= en pause, rouge \= erreur).  
* **Reconnexion automatique** : Gestion robuste des pertes de connexion réseau avec reconnexion automatique aux sockets.

  3. ## Interface publique {#interface-publique-1}

**Page Match** : Un tableau de score dynamique, un timer précis, l'affichage de la phase de jeu actuelle et des messages sponsorisés.

**Page Tournoi** : Une liste complète des matchs terminés et en cours, avec des liens directs vers les pages live correspondantes.

**Page Équipe/Joueur** : Des statistiques globales et les performances récentes de chaque équipe et joueur.

4. ## Interface joueur {#interface-joueur-1}

**Page personnelle** : Intégration du lien Steam et du lien faceIT, planning des matchs

**Notification de match** : Réception de notification lorsque le serveur est prêt avec un bouton pour le rejoindre

**Lecture seule** : Accès aux informations de match sans aucune commande critique.

5. ## Compatibilité et accessibilité {#compatibilité-et-accessibilité}

**Navigateurs pris en charge** : Compatibilité étendue avec Chrome, Edge et Firefox.

**Responsive design** : Une interface optimisée pour PC, tablette et TV.

6. ## Critères de réussite {#critères-de-réussite-2}

**Compréhension intuitive** : Scoreboard et commandes administrateur utilisables sans formation préalable.

**Synchronisation parfaite** : Cohérence visuelle avérée entre les interfaces administrateur, publique et joueur.

**Exploitabilité optimale** : L'interface doit être pleinement fonctionnelle sur scène LAN sans aucune perte de lisibilité.

6. # Données et Stockage {#données-et-stockage}

**GG-Core** repose sur une architecture événementielle et relationnelle. Les données brutes issues des logs CS2 sont transformées en événements structurés, stockés dans PostgreSQL pour l'historique et diffusés via Redis pour le temps réel.

1. ## Schéma de base de données {#schéma-de-base-de-données}

**Tables principales :**

* **tournaments** : métadonnées du tournoi (nom, format, date, règles).  
* **teams** : équipes, logo, tag.  
* **players** : identifiants internes (UUID), SteamID, pseudo, faceItID, équipe associée.  
* **matches** : entité centrale (équipes, map, score, état).  
* **events\_primary (Vérité absolue)** : événements primordiaux (kills, début/fin de round, bombe, chat).  
* **events\_secondary** : télémétrie (positions, grenades, CSTV).  
* **scoreboard\_player\_match / team\_match** : projections temps réel.

**Relations :**

* `players.team_id` → `teams.id`  
* `matches.tournament_id` → `tournaments.id`  
* `events_primary.match_id` → `matches.id`  
* `scoreboard_*` matérialisées à partir des événements.

**Partitionnement :**

Les tables `events_*` sont partitionnées par `tournament_id` pour faciliter la purge et les requêtes.

3. ## Gestion du Temps Réel {#gestion-du-temps-réel}

**Redis Pub/Sub** : diffusion immédiate des événements entre services.

**Redis Streams** (optionnel) : persistance courte durée pour tolérance aux pannes.

**Snapshot** : Structure sérialisée du match courant (scores, côtés, pauses, rounds) servant à restaurer l'état d'un match après redémarrage.

4. ##  Volumétrie Estimée {#volumétrie-estimée}

| Élément | Taille par match | Taille par tournoi (10 matchs) |
| :---- | :---- | :---- |
| Événements primaires | \~50 000 lignes | \~500 000 lignes |
| Scoreboard joueurs | \~20 ko | \~200 ko |
| Snapshots | \~100 ko | \~1 Mo |
| **Total (par tournoi)** |  | **≈ 300–400 Mo** |

7. # Exigences non fonctionnelles  {#exigences-non-fonctionnelles}

   1. ## Maintenabilité et extensibilité {#maintenabilité-et-extensibilité}

**Code modulaire** (agents Go, backend NestJS, front React + Vite).

**Contrats stables** (DTO/Events versionnés).

**Projections régénérables** à partir des événements.

3. ## Portabilité et déploiement {#portabilité-et-déploiement}

**Docker Compose** pour LAN/prod.

**Zéro dépendance** Internet en mode LAN.

4. ## Observabilité {#observabilité}

**Logs structurés JSON** avec corrélation matchId, serverId, seq.

**Healthchecks** /health pour chaque service.

**Métriques** : latence event→WS, backlog Redis, RPS, erreurs RCON.

5. ## Conformité et données {#conformité-et-données}

**RGPD minimal** : aucune donnée sensible ; pseudonymes joueurs \+ SteamID.

**Politique de rétention configurable** (purge tournois anciens).

**Exports traçables** (horodatage, hash optionnel).

**Suppression ou export** possible sur demande d’un joueur.

7. ## Résilience aux erreurs {#résilience-aux-erreurs}

**Idempotence des commandes RCON**.

**Mode dégradé :** lecture sur snapshots si projections manquantes.

9. # Lexique étendu  {#lexique-étendu}

- **ADR (Average Damage per Round) :** Dégâts moyens infligés par round, indicateur de performance.  
- **Agent :** Programme (Go) connecté à un serveur CS2, exécutant les commandes RCON, collectant les logs HTTP et les publiant dans Redis  
- **Armor / Kevlar / Helmet :** Équipement de protection réduisant les dégâts reçus.  
- **Backend (NestJS) :** Serveur d’application gérant logique, API et WebSockets.  
- **Bomb plant / defuse :** Pose ou désamorçage de la bombe, objectif central du jeu.  
- **Bracket :** Arbre de tournoi (simple ou double élimination) montrant la progression des équipes.  
- **Buy / Économie :** Phase d’achat d’armes et équipements avant un round.  
- **Clutch :** Situation où un joueur seul gagne un round contre plusieurs adversaires (ex : 1v3).  
- **CT (Counter-Terrorist) :** Camp défensif, empêche la pose ou désamorce la bombe.  
- **CSTV / GOTV :** Système d’observation et d’enregistrement de matchs CS2, transmet positions et grenades.  
- **Demo :** Fichier d’enregistrement complet d’un match (replay).  
- **Drop :** Action de donner une arme à un coéquipier.  
- **Eco / Eco round :** Round avec peu d’achat pour économiser.  
- **Eco-kill :** Élimination avec arme faible durant un round éco.  
- **Entry kill :** Première élimination d’un round.  
- **Entry trade :** Réponse immédiate après la mort d’un coéquipier.  
- **Flash :** Grenade aveuglante désorientant les adversaires.  
- **Force buy :** Achat forcé malgré faible économie.  
- **Freeze time :** Temps d’attente avant le début d’un round.  
- **HS (Headshot) :** Tir à la tête, inflige plus de dégâts.  
- **HUD (Heads-Up Display) :** Interface du jeu affichant score, timer, etc.  
- **Knife round :** Round au couteau servant à déterminer les sides de départ.  
- **K/D (Kill/Death ratio) :** Ratio kills/morts d’un joueur.  
- **LAN :** Tournoi en réseau local sans Internet.  
- **Map :** Carte de jeu (Mirage, Inferno, Nuke…).  
- **Match / Round :** Ensemble de rounds formant un match.  
- **Molotov / Incendiary :** Grenade incendiaire bloquant une zone.  
- **Money :** Argent accumulé par joueur pour acheter son équipement.  
- **Overtime :** Prolongation en cas d’égalité (ex : 12–12).  
- **Pause tactique :** Pause courte demandée par une équipe pour discuter stratégie.  
- **Pause technique :** Pause longue décidée par un admin pour problème matériel ou réseau.  
- **Pick / Veto :** Sélection ou élimination de cartes avant le match.  
- **Pistol round :** Premier round joué uniquement avec armes de poing.  
- **Plant :** Pose de la bombe par les Terrorists.  
- **RCON (Remote Console) :** Protocole pour contrôler à distance les serveurs CS2.  
- **Redis :** Base en mémoire servant de bus temps réel.  
- **Retake :** Reprise de site après la pose de la bombe.  
- **Round bonus / loss bonus :** Compensation économique pour équipe perdante.  
- **Scoreboard :** Tableau des statistiques (kills, deaths, assists…).  
- **Smoke :** Grenade fumigène bloquant la vision.  
- **Snapshot :** Image instantanée de l’état du match (score, pauses, économie).  
- **Swap :** Échange des côtés CT/T à la mi-temps ou après un knife.  
- **T (Terrorist) :** Camp offensif chargé de poser la bombe.  
- **Timeout :** Synonyme de pause tactique.  
- **Trade :** Élimination d’un adversaire juste après la mort d’un coéquipier.  
- **Triple / Quad / Ace :** 3, 4 ou 5 kills dans un round par un seul joueur.  
- **Utility :** Ensemble des grenades et équipements.  
- **WebSocket :** Canal bidirectionnel temps réel entre backend et frontend.  
- **Wallbang :** Tir à travers un mur ou un obstacle mince.  
- **Whitelist / SteamID :** Mécanisme complémentaire de sécurité listant les SteamID autorisés à rejoindre un match. Le mot de passe du match est toujours obligatoire, la whitelist SteamID peut s’y ajouter pour restreindre davantage les accès ou bloquer des joueurs précis.


10. # Annexes {#annexes}

    1. ## Schéma d’architecture en partant du serveur {#schéma-d’architecture-en-partant-du-serveur}

##  ![][image1]

2. ## Schéma d’architecture en partant du front end {#schéma-d’architecture-en-partant-du-front-end}

## ![][image2]

[image1]: <data:image/png;base64,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>

[image2]: <data:image/png;base64,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>