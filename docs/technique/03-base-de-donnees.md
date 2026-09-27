# 3. Base de données

[← Front-end](02-front-end.md) · [Sommaire](README.md) · Suivant : [Référence API →](04-reference-api.md)

Toute la base est définie par les fichiers de
[supabase/migrations/](../../supabase/migrations/), exécutés dans l'ordre
dans l'éditeur SQL de Supabase. Cette page décrit **l'état final** après
toutes les migrations ; l'[historique](#historique-des-migrations) en bas
dit quelle migration a apporté quoi.

## Schéma

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "1 profil"
  AUTH_USERS ||--o{ COLLECTIONS : possède
  AUTH_USERS ||--o{ BOOSTER_OPENINGS : ouvre
  AUTH_USERS ||--o{ WISHLIST : cherche
  AUTH_USERS ||--o| CHALLENGE_WALLETS : "portefeuille (Défi)"
  AUTH_USERS ||--o{ CHALLENGE_LEDGER : "mouvements de pièces"
  AUTH_USERS ||--o{ TRADE_OFFERS : "envoie / reçoit"
  AUTH_USERS ||--o{ TRADE_LOCKS : verrouille
  AUTH_USERS ||--o{ ACHIEVEMENT_UNLOCKS : débloque
  AUTH_USERS ||--o{ MINIGAME_RUNS : joue
  PROFILES ||--o{ PULL_FEED : "gros tirages"
  SETS ||--o{ CARDS : contient
  SETS ||--o{ SETS : "sous-set de"
  CARDS ||--o{ COLLECTIONS : ""
  CARDS ||--o{ CARD_PRICE_HISTORY : "prix hebdo"
  CARDS ||--o{ WISHLIST : ""
```

## Lire les règles d'accès

Chaque table a la **RLS activée**. Dans les tableaux ci-dessous :

- **Lecture** : qui peut faire un `select` depuis le navigateur ;
- **Écriture client** : ce que le navigateur peut écrire directement.
  « Aucune » veut dire que seules les fonctions SQL (`SECURITY DEFINER`) ou
  la clé service role écrivent dans la table.

`anon` = visiteur non connecté, `authenticated` = joueur connecté,
`auth.uid()` = l'identifiant du joueur qui fait la requête.

---

## Catalogue de cartes

Remplies par [scripts/populate.mjs](../../scripts/populate.mjs) (clé
service role) depuis pokemontcg.io. Actuellement 176 sets et 20 670 cartes.

### `sets`

| Colonne | Type | Sens |
| --- | --- | --- |
| `id` | text, PK | Identifiant pokemontcg.io (`sv3pt5`, `base1`…) |
| `name` | text | Nom du set |
| `release_date` | date | Date de sortie (sert aux tris et groupes par année) |
| `printed_total`, `total` | int | Nombre de cartes imprimé / réel |
| `logo_url`, `symbol_url` | text | Images du set. Depuis 2026, les nouveaux sets sont sur `images.scrydex.com` avec un autre schéma d'URL : on stocke ce que l'API donne au lieu de deviner l'URL à partir de l'id |
| `parent_set_id` | text → `sets.id` | Renseigné pour un **sous-set** (Trainer Gallery, Galarian Gallery, Shiny Vault, Classic Collection) : le set dont les boosters contiennent ses cartes |
| `subset_rate` | numeric 0–1 | Chance qu'un booster du parent contienne une carte de ce sous-set (TG 25 %, Shiny Vault 30 %, les autres 33 %) |

Lecture : tout le monde. Écriture client : aucune.

### `cards`

| Colonne | Type | Sens |
| --- | --- | --- |
| `id` | text, PK | `sv3pt5-199`… |
| `name`, `rarity` | text | Nom, rareté brute (~45 libellés selon les époques) |
| `rarity_bucket` | text, **générée** | Une des 6 raretés du jeu, calculée par `rarity_bucket(rarity)` (voir plus bas) |
| `value` | numeric | Prix en € : moyenne de vente Cardmarket, sinon prix TCGplayer converti depuis l'USD (sets récents sans Cardmarket, `cardPriceEur`), 0 si inconnu |
| `image_url`, `image_small` | text | Grande et petite image |
| `artist`, `supertype`, `subtypes`, `hp`, `types` | … | Métadonnées de la carte (supertype = `Pokémon`, `Trainer`, `Energy`) |
| `national_pokedex_number` | int | Numéro du Pokédex national (onglet Pokédex, succès) |
| `set_id` | text → `sets.id` | Set de la carte |

Index : `(set_id)`, `(set_id, rarity_bucket)` (tirage par rareté).
Lecture : tout le monde. Écriture client : aucune.

### `card_price_history`

Un relevé de prix par carte et par jour d'import (`card_id`, `recorded_on`,
`value`), écrit à chaque `populate:cards`. Alimente la courbe de prix de
la fiche carte. Lecture : tout le monde. Écriture client : aucune.

### Les 6 raretés (`rarity_bucket`)

Les libellés bruts ont changé à chaque époque ; le jeu les regroupe en 6
niveaux. **Miroir** : `rarity_bucket()` en SQL (migration 0003) et
`rarityBucket()` dans [src/utils/rarity.js](../../src/utils/rarity.js).

| Rareté | Contient |
| --- | --- |
| `common` | Common, Promo, sans rareté (énergies de base) |
| `uncommon` | Uncommon |
| `rare` | Rare |
| `holo` | Rare Holo, ex/EX/GX/V/VMAX/VSTAR, Double Rare, Radiant, ACE SPEC… (tout autre libellé contenant « rare » ou « holo ») |
| `ultra` | Ultra Rare, Illustration Rare, Trainer Gallery, Shiny… |
| `secret` | Special Illustration Rare, Hyper Rare, Secret, Rainbow |

Côté affichage, `rarityTier()` les regroupe en 3 niveaux visuels :
commune (common, uncommon), rare (rare, holo), **hit** (ultra, secret).

---

## Joueurs et collections

### `profiles`

Une ligne par compte, créée **par un trigger** à l'inscription
(`handle_new_user` sur `auth.users`) avec le pseudo choisi à l'inscription,
ou le début de l'e-mail. Si le pseudo est pris, `unique_username()` ajoute
un suffixe numérique.

| Colonne | Type | Sens |
| --- | --- | --- |
| `id` | uuid, PK → `auth.users` | Le compte |
| `username` | text | Unique **sans tenir compte de la casse** (index sur `lower(username)`), 2 à 24 caractères, sans espaces autour ni caractères de contrôle |
| `is_public` | bool, défaut vrai | Profil visible des autres, présent dans le fil et les classements |
| `showcase_card_id` | text → `cards` | Carte vitrine ; un trigger vérifie qu'elle est possédée en Illimité |
| `accepts_trades` | bool, défaut vrai | Faux = personne ne peut lui proposer d'échange |
| `created_at`, `updated_at` | timestamptz | |

Lecture : les profils publics + le sien. Écriture client : **uniquement
son propre profil**, et **uniquement** les colonnes `username`,
`is_public`, `showcase_card_id`, `accepts_trades` (droits par colonne).

### `collections`

| Colonne | Type | Sens |
| --- | --- | --- |
| `user_id` | uuid → `auth.users` | Propriétaire |
| `mode` | text | `'unlimited'` ou `'challenge'` |
| `card_id` | text → `cards` | La carte |
| `quantity` | int > 0 | Nombre d'exemplaires |
| `acquired_at` | timestamptz | Première obtention |

Clé primaire : `(user_id, mode, card_id)`. Lecture : **ses propres lignes
uniquement**. Écriture client : **aucune**. Seuls l'ouverture de packs, le
recyclage, la fabrication et les échanges (fonctions SQL) la modifient,
toujours avec des `INSERT … ON CONFLICT DO UPDATE` atomiques. Les
collections des autres joueurs se lisent via `public_collection()` et
`challenge_collection_of()`, qui vérifient que le profil est public.

### `booster_openings`

Le journal de **chaque pack ouvert** (depuis la migration 0004 : les
packs Illimité plus anciens n'ont pas été enregistrés).

| Colonne | Sens |
| --- | --- |
| `id`, `user_id`, `mode`, `set_id`, `opened_at` | Qui, quel mode, quel set, quand |
| `card_ids` | Les 10 ids dans l'ordre du pack |
| `best_card_id` | Meilleure carte (rareté la plus haute, puis la plus chère) |
| `hits`, `secrets` | Nombre de cartes ultra+secret, et secret seules |
| `god_pack` | Pack divin du Défi |

Lecture : ses propres lignes. Écriture client : aucune. Sert à
l'historique, aux statistiques de succès, aux missions et au classement
« taux de hits ». La limite de fréquence (60 packs/minute) se compte aussi
ici.

### `wishlist`

`(user_id, card_id, created_at)`, clé `(user_id, card_id)`, `user_id` vaut
`auth.uid()` par défaut. Données personnelles : le joueur lit, ajoute et
retire **ses** lignes directement. Une carte tirée en Illimité en est
retirée automatiquement par le serveur.

### `pull_feed`

Fil public des **gros tirages** (ultra et secret) des profils publics,
dénormalisé pour s'afficher sans jointure : `user_id`, `username`,
`card_id`, `card_name`, `image_small`, `bucket`, `set_id`, `mode`,
`pulled_at`. Publié dans **Supabase Realtime** (fil en direct). Les lignes
de plus de 30 jours sont purgées de temps en temps (2 % des ouvertures).
Lecture : les lignes des profils publics. Écriture client : aucune.

---

## Mode Défi

### `challenge_wallets`

Une ligne par joueur, créée au premier appel d'une fonction du Défi avec
**1000 pièces de départ**.

| Colonne | Sens |
| --- | --- |
| `user_id` | PK |
| `coins` | Solde (≥ 0, contrainte) |
| `daily_streak`, `last_daily_on` | Série de récompenses quotidiennes et dernier jour réclamé |
| `created_at` | |

Lecture : la sienne. Écriture client : aucune. **Chaque fonction du Défi
commence par verrouiller cette ligne** (`lock_challenge_wallet`,
`SELECT … FOR UPDATE`) : c'est le verrou par joueur qui empêche deux
onglets de dépenser les mêmes pièces.

### `challenge_ledger`

Le journal de **chaque mouvement de pièces** : `kind` (`start`, `daily`,
`booster`, `recycle`, `craft`, `mission`, `minigame`), `amount` (+ gagné,
− dépensé), `card_id`, `quantity`, `mission`, `game_day`, `created_at`.

Un index unique `(user_id, mission, game_day) where kind = 'mission'`
garantit qu'une mission n'est réclamée qu'une fois par jour. Les missions
hebdomadaires sont datées du lundi de la semaine : le même index les rend
réclamables une fois par semaine. Lecture : le sien. Écriture client :
aucune.

**Jour de jeu = UTC** : `challenge_today()` renvoie la date UTC ; les
missions quotidiennes et la récompense changent à 00:00 UTC, les missions
hebdomadaires le lundi à 00:00 UTC (`challenge_week_start()`).

### `trade_offers`

| Colonne | Sens |
| --- | --- |
| `id`, `from_user`, `to_user` | Offre de `from_user` à `to_user` (jamais soi-même) |
| `offer_cards` | 1 à 5 ids donnés (un exemplaire chacun) |
| `request_cards` | 0 à 5 ids demandés (0 = cadeau) |
| `status` | `pending`, `accepted`, `declined`, `cancelled`, `failed` |
| `created_at`, `resolved_at` | Une offre en attente expire après 7 jours (`trade_ttl()`) |

Lecture : les deux joueurs concernés. Écriture client : aucune. Publiée
dans Realtime (la RLS s'applique : chacun ne reçoit que ses offres).

### `trade_locks`

`(user_id, card_id)` : cartes du Défi que le joueur garde hors échanges.
Données personnelles, écrites par le joueur (lecture, ajout, suppression
de ses lignes).

### `minigame_runs`

Une ligne par partie de « Plus ou moins » : `paid` (payée ou non),
`streak`, `coins`, `left_card`, `right_card`, `shown_at` (quand la paire
a été tirée), `status` (`playing`, `lost`, `timeout`, `abandoned`),
`game_day`. Une seule partie `playing` par joueur (index unique).
**Aucun accès client**, même en lecture : les prix de la paire en cours ne
doivent pas fuiter.

---

## Succès

### `achievement_unlocks`

`(user_id, mode, achievement_id, unlocked_at)`, clé `(user_id, mode,
achievement_id)`. Les ids déclarés par le client via
`record_achievements()` (format vérifié : `^[A-Za-z0-9_]{1,48}$`, 500 au
maximum par appel). Sert à deux choses : un succès déjà enregistré **reste
débloqué** même si la collection rétrécit (recyclage, échanges), et au
calcul des taux (« 12 % des joueurs »). **Aucun accès client direct** :
seulement les fonctions.

---

## Fonctions internes

Ces fonctions ne sont **pas appelables** par les clients (droits retirés) ;
elles servent de briques aux RPC décrites dans la
[Référence API](04-reference-api.md).

| Fonction | Rôle |
| --- | --- |
| `rarity_bucket(rarity)` | Libellé brut → une des 6 raretés |
| `open_booster(set_id)` | Tire un pack de 10 cartes ([détail](05-parcours.md#le-tirage-côté-serveur-open_booster)) |
| `pick_booster_card(set, bucket, exclude)` | Une carte d'une rareté, sinon la rareté inférieure qui existe dans le set, sans doublon dans le pack |
| `pick_subset_card(subset, exclude)` | Une carte de sous-set : surtout holo, parfois ultra (36 %), rarement secret (4 %) |
| `save_booster_opening(user, mode, cards, god_pack)` | Ajoute les cartes à la collection, journalise le pack, retire de la liste de souhaits (Illimité), publie les hits dans le fil |
| `check_booster_rate(user)` | Refuse au-delà de 60 packs par minute |
| `require_player()` | `auth.uid()` ou erreur `not_authenticated` |
| `lock_challenge_wallet(user)` | Crée le portefeuille si besoin (1000 pièces + ligne `start`), puis le verrouille |
| `challenge_missions(user)`, `challenge_weekly_missions(user)` | Missions du jour et de la semaine avec leur progression |
| `challenge_recycle_value(bucket)`, `challenge_craft_price(bucket)`, `challenge_daily_reward(streak)` | Barème du Défi (**miroir** : `src/utils/challenge.js`) |
| `owns_challenge_cards`, `move_challenge_cards`, `has_trade_lock`, `trade_ttl` | Vérifications et transfert des échanges |
| `minigame_rules`, `minigame_min_ratio`, `minigame_pair`, `minigame_card` | Règles et tirage des paires du mini-jeu |
| `handle_new_user`, `unique_username`, `profiles_before_update` | Création du profil, pseudo libre, contrôle de la vitrine |
| `link_subsets`, `guess_subset_parent`, `subset_default_rate` | Relie les nouveaux sous-sets à leur parent (service role, appelé par l'import) |

---

## Historique des migrations

Chaque fichier commence par un commentaire qui détaille ce qu'il fait.
Toutes sont conçues pour pouvoir être relancées sans casse.

| # | Fichier | Apporte |
| --- | --- | --- |
| 0001 | `schema` | `sets`, `cards`, `collections` + RLS de base |
| 0002 | `functions` | Premières RPC (tirage uniforme). **Inutilisées**, `add_cards_to_collection` supprimée en 0004 |
| 0003 | `realistic_boosters` | Raretés (`rarity_bucket`), packs réalistes slot par slot (`open_booster`), URL des logos |
| 0004 | `collector_social` | Modes, collections écrites par le serveur seul, `open_my_booster`, profils, historique, fil, liste de souhaits, prix, classements |
| 0005 | `challenge_mode` | Mode Défi : portefeuille, journal, économie, missions, recyclage, fabrication |
| 0006 | `challenge_no_pity` | Suppression du « pity timer » (taux réels, comme en Illimité) ; les packs divins restent |
| 0007 | `challenge_trades` | Échanges, classements du Défi, badge de navigation |
| 0008 | `achievement_rates` | Taux de possession des succès |
| 0009 | `achievements_by_mode` | Succès par mode, `player_achievements` |
| 0010 | `subsets_and_pack_stats` | Sous-sets dans les boosters de leur parent, statistiques exactes de packs |
| 0011 | `weekly_missions_live_trades` | Missions hebdomadaires, échanges en temps réel |
| 0012 | `trade_preferences` | Refuser les échanges, cartes hors échange |
| 0013 | `minigame_higher_lower` | Mini-jeu « Plus ou moins » (écrite le 2026-09-26, **à appliquer**) |

Les migrations 0001 à 0012 sont appliquées sur le projet réel (vérifié le
2026-09-26).
