# Documentation technique — PokéBooster

Cette documentation explique **comment le projet fonctionne de l'intérieur** :
quels fichiers font quoi, quelles requêtes partent vers Supabase et ce
qu'elles renvoient, et ce qui se passe, étape par étape, quand un joueur
ouvre un booster, consulte un profil ou échange une carte.

Le [README](../../README.md) à la racine dit *quoi* installer et lancer ;
ce dossier dit *comment ça marche*.

## Par où commencer

La doc est découpée en niveaux : chaque page suppose d'avoir lu les
précédentes, mais s'arrête dès que tu en sais assez.

| Niveau | Page | Tu y apprends |
| --- | --- | --- |
| 1 | [Vue d'ensemble](01-vue-d-ensemble.md) | Ce qu'est l'app, les grandes briques, qui fait quoi entre le navigateur et le serveur, le modèle de sécurité |
| 2 | [Front-end](02-front-end.md) | Démarrage, routes, stores Pinia, couche `api/`, composables, utilitaires, i18n, design system, PWA |
| 2 | [Base de données](03-base-de-donnees.md) | Chaque table, ses colonnes, qui peut la lire ou l'écrire, les raretés, l'historique des migrations |
| 3 | [Référence API](04-reference-api.md) | Chaque appel Supabase : paramètres, réponse (exemples JSON), erreurs possibles |
| 3 | [Parcours détaillés](05-parcours.md) | Les scénarios de bout en bout avec diagrammes : inscription, ouverture d'un booster, profil, défi, échanges, mini-jeu, succès, communauté |
| 4 | [Outillage et exploitation](06-outillage.md) | Tests (unitaires, base de données, e2e), CI, import des cartes, déploiement, écrire une migration |

Tu cherches un point précis ? Quelques raccourcis :

- « Que se passe-t-il quand j'ouvre un booster ? » → [Parcours > Ouvrir un booster](05-parcours.md#2-ouvrir-un-booster)
- « D'où viennent les chiffres du profil ? » → [Parcours > Afficher un profil](05-parcours.md#3-afficher-un-profil)
- « Que renvoie `open_challenge_booster` ? » → [Référence API > Mode Défi](04-reference-api.md#mode-défi)
- « Qui a le droit d'écrire dans `collections` ? » → [Base de données > collections](03-base-de-donnees.md#collections)
- « Comment ajouter une page / un succès / un mini-jeu ? » → [Front-end > Recettes](02-front-end.md#10-recettes--ajouter-quelque-chose)

## Conventions de cette doc

- Les noms de code (fichiers, fonctions, colonnes) restent en anglais,
  comme dans le code. Les liens pointent vers les fichiers du dépôt.
- « Illimité » = le mode `unlimited`, « Défi » = le mode `challenge`.
- Les diagrammes sont en [Mermaid](https://mermaid.js.org/) : GitHub les
  affiche directement.
- Quand une règle est dupliquée entre SQL et JavaScript (raretés,
  économie du Défi, règles du mini-jeu), la doc le signale avec
  **« miroir »** : il faut changer les deux ensemble.

## Tenir cette doc à jour

Cette doc vit dans le dépôt pour évoluer **dans le même commit que le
code** qu'elle décrit. La règle (aussi écrite dans `CLAUDE.md`) :

- une nouvelle table, colonne ou RPC → [Base de données](03-base-de-donnees.md) + [Référence API](04-reference-api.md) ;
- une nouvelle route, un store, un composable → [Front-end](02-front-end.md) ;
- un comportement de jeu qui change (packs, économie, profil, succès…) → le parcours concerné dans [Parcours détaillés](05-parcours.md) ;
- un nouvel outil, script ou étape de déploiement → [Outillage](06-outillage.md).

Dernière mise à jour : 2026-10-05 (PvP réservé à ses testeurs le temps de retravailler les règles, migration 0028 ; combats PvP contre des bots pour des pièces, sans Elo, migration 0027 ; combats PvP : deck d'attaque et deck de défense séparés, « Deck auto », plus d'attaque gratuite par erreur, migration 0026 ; import des cartes qui ne s'arrête plus en silence sur une page en échec ; combats PvP en différé, migrations 0024 et 0025 : decks par format, énergie et choix de l'attaque, cartes Récompense, Elo, deck adverse joué par le serveur ; passe sur le vrai site : plus jamais l'e-mail comme nom en attendant le profil, fil de Communauté regroupé par joueur et paginé, toasts d'une ligne et meilleure carte à côté de son nom au récapitulatif ; second parcours critique : pseudo obligatoire à l'inscription et migration 0023 (plus de pseudo tiré de l'e-mail), onglet Inscription par défaut, Pokédex et rareté en français, défi en bref sous le portefeuille, heure de remise à zéro locale, bouton Ouvrir visible sur portable, accès direct aux réglages ; parcours d'un nouveau joueur : nombre de boosters et nom du set plus jamais cachés par le bouton collé, sets proposés au premier booster, recherche par nom français, toast unique sur téléphone et après 1,5 s au récapitulatif, règles du Défi en haut, récompense du jour réclamée à un seul endroit, échanges guidés pour un nouveau joueur, série la plus avancée comme objectif, réglage « Texte plus grand » ; son rang sous les classements et « Qui l'a en double ? », migration 0022 ; récapitulatif de booster : boutons collés en bas sur téléphone, toasts en bas ; missions de la semaine repliables sur téléphone ; pièces dans le bandeau Défi sur toutes les pages ; espaces insécables en français ; contre-offres, migration 0021 ; « Voir plus » dans les sélecteurs d'échange ; recyclage : « Garder » 1 à 4 exemplaires, − / + aussi sur la fiche d'une carte ; recyclage : choisir combien d'exemplaires d'une carte, migration 0020 ; fil de Communauté : switch Défi | Illimité ; succès : focus Paldea (~70 nouveaux), toutes les régions ont leur fichier ; focus Galar (~75 nouveaux) ; focus Alola (~100 nouveaux) ; focus Kalos (~85 nouveaux) ; focus Unys (~130 nouveaux) ; focus Sinnoh (~110 nouveaux) ; focus Hoenn (~105 nouveaux), régions en fichiers génériques (`REGION_FOCUS`), outil `scripts/region-tools.mjs` ; focus Johto (~75 nouveaux : lignées d'Or/Argent, routes 29 à 46, grottes et tours, Conseil 4 de Johto, dresseurs et lieux en cartes, séries Neo et HGSS) ; « Chaîne d'évolution » : lignées à 2 stades et bouton Arrêter, migration 0019 ; mini-jeu « Chaîne d'évolution », migration 0018 ; succès : gros focus Kanto (~100 nouveaux : lignées, solitaires, routes, villes, dresseurs en cartes), doublons retirés, sous-catégories et filtre par région ; réponses aux offres d'échange signalées (badge, toasts en direct), raccourci Échanges sur téléphone, « Proposer en échange » depuis une carte, recyclage au choix ; ~130 nouveaux succès (lignées, légendes, arènes, Ligue, rivaux, lieux) ; migration 0017 ; autocomplétion du partenaire d'échange et exemplaires possédés dans les sélecteurs ; holo des vieux sets dans le fil ; migrations 0001 à 0016 ; complétion des sets dans la sélection de booster ; classements par mode ; mini-jeu « Super efficace ! » ; deux mini-jeux annoncés ; synchro des cartes à minuit et midi).
