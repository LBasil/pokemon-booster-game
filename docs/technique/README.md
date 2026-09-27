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

Dernière mise à jour : 2026-09-27 (migrations 0001 à 0013).
