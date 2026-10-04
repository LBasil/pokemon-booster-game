# 4. Référence API

[← Base de données](03-base-de-donnees.md) · [Sommaire](README.md) · Suivant : [Parcours détaillés →](05-parcours.md)

Toutes les requêtes partent de supabase-js, via les fichiers de
[src/api/](../../src/api/). Il y a trois sortes d'appels :

| Sorte | En JS | Sur le réseau |
| --- | --- | --- |
| **Lecture/écriture de table** | `supabase.from('cards').select(...)` | `GET/POST/PATCH/DELETE /rest/v1/<table>?…` (PostgREST) |
| **RPC** (fonction SQL) | `supabase.rpc('open_my_booster', { p_set_id })` | `POST /rest/v1/rpc/open_my_booster` avec les paramètres en JSON |
| **Temps réel** | `supabase.channel(...).on('postgres_changes', …)` | WebSocket Realtime |

Chaque requête porte la clé anon et, si le joueur est connecté, son jeton
(JWT). Postgres en déduit `auth.uid()` et applique la RLS.

**Accès** dans les tableaux : *public* = aussi sans être connecté,
*connecté* = compte requis (sinon erreur `not_authenticated`, ou droit
refusé).

---

## Forme d'une carte

Beaucoup de réponses contiennent des cartes. Une carte = une ligne de
`cards` :

```json
{
  "id": "sv3pt5-199",
  "name": "Charizard ex",
  "rarity": "Special Illustration Rare",
  "rarity_bucket": "secret",
  "value": 301.52,
  "image_small": "https://images.pokemontcg.io/sv3pt5/199.png",
  "image_url": "https://images.pokemontcg.io/sv3pt5/199_hires.png",
  "set_id": "sv3pt5",
  "supertype": "Pokémon",
  "subtypes": ["Stage 2", "ex"],
  "hp": 330,
  "types": ["Fire"],
  "artist": "…",
  "national_pokedex_number": 6
}
```

Une **entrée de collection** (réponse de `fetchCollection`,
`public_collection`, `challenge_collection_of`) :

```json
{ "card_id": "sv3pt5-199", "quantity": 2, "acquired_at": "2026-09-20T18:03:11Z", "cards": { "...carte..." } }
```

---

## Authentification (Supabase Auth)

Appels faits par [src/stores/auth.js](../../src/stores/auth.js), sans passer
par `api/`.

| Appel | Utilisé pour | Détail |
| --- | --- | --- |
| `auth.signUp({ email, password, options })` | Inscription | `options.data.username` = pseudo voulu, obligatoire côté formulaire (lu par le trigger qui crée le profil ; absent → `Trainer-1234` depuis 0023) ; `emailRedirectTo` = `<site>/game` |
| `auth.signInWithPassword({ email, password })` | Connexion | Renvoie la session |
| `auth.resetPasswordForEmail(email, { redirectTo })` | Mot de passe oublié | Lien vers `<site>/reset-password` |
| `auth.updateUser({ password })` | Nouveau mot de passe | Depuis `/reset-password` (session de récupération) |
| `auth.signOut()` | Déconnexion | Le store vide aussi toutes les données du joueur |
| `auth.getSession()` + `onAuthStateChange` | Au démarrage | Si le compte change, les stores du joueur sont vidés |

Les deux URL de redirection doivent être autorisées dans *Supabase >
Authentication > URL Configuration*.

---

## Catalogue

| Fonction JS | Requête | Accès | Réponse |
| --- | --- | --- | --- |
| `fetchSets()` | `sets` : `select id, name, release_date, printed_total, total, logo_url, symbol_url, parent_set_id, subset_rate order by release_date desc` | public | Tous les sets. Réessaie sans les colonnes de 0010 puis de 0003 si elles manquent |
| `fetchPoolStats()` | `count` exact sur `sets` et `cards` (requêtes `HEAD`) | public | `{ sets: 176, cards: 20670 }` (bandeau de l'accueil) |
| `fetchSetCover(setId)` | `cards` : Pokémon du set parmi les `secret/ultra/holo`, `order by value desc limit 1` | public | La carte phare affichée sur le booster, ou `null` |
| `fetchSetCards(setId)` | `cards` du set | public | Toutes les cartes du set (classeur) |
| `fetchCardsByIds(ids)` | `cards` `in (ids)` | public | Cartes de l'historique |
| `fetchPokedexSize()` | plus grand `national_pokedex_number` | public | ex. `1025` |
| `fetchPriceHistory(cardId)` | `card_price_history` de la carte, par date | public | `[{ "recorded_on": "2026-09-14", "value": 290.1 }, …]` |

---

## Collection, historique, souhaits

| Fonction JS | Requête | Accès | Réponse |
| --- | --- | --- | --- |
| `fetchCollection(mode)` | `collections` : `select card_id, quantity, acquired_at, cards(*)` `mode = …` `order by acquired_at desc` | connecté (RLS : ses lignes) | Entrées de collection, les plus récentes d'abord |
| `fetchCollectionStats(mode)` | `count` des lignes de `collections` du mode + `count` de `cards` | connecté | `{ uniqueOwned, totalCards }` |
| `fetchOpenings({ mode, before, limit, hitsOnly })` | `booster_openings` du mode, `opened_at < before`, `hits > 0` si `hitsOnly`, 20 par page | connecté | `[{ id, set_id, card_ids, best_card_id, hits, secrets, god_pack, opened_at }]` |
| `fetchWishlist()` | `wishlist` : `select card_id, created_at, cards(*)` | connecté | Cartes recherchées |
| `addToWishlist(cardId)` | `insert { card_id }` (`user_id` = `auth.uid()` par défaut) | connecté | — (déjà présente : ignoré) |
| `removeFromWishlist(cardId)` | `delete where card_id = …` | connecté | — |

---

## Ouvrir un booster (Illimité)

### `open_my_booster(p_set_id text = null, p_mode text = 'unlimited')`

JS : `openBooster(setId)`. Accès : connecté.

Tire un pack (`open_booster`), l'ajoute à la collection Illimité, le
journalise, retire les cartes tirées de la liste de souhaits et publie les
hits dans le fil (si le profil est public). **Tout en une transaction** :
si l'appel réussit, les cartes sont sauvegardées.

- `p_set_id` : un id de set, ou `null` = « n'importe quel set » (un set
  réel au hasard par pack, jamais un mélange). Un id de sous-set ouvre le
  booster de son parent.
- Réponse : **tableau de 10 cartes** dans l'ordre du pack.

| Erreur | Quand |
| --- | --- |
| `not_authenticated` | Pas connecté |
| `too many boosters opened, slow down a little` | Plus de 60 packs dans la dernière minute (tous modes confondus) |
| `mode … is opened with open_challenge_booster` | `p_mode` autre que `unlimited` |
| `open_booster: no cards for set …` | Set inconnu ou vide |

---

## Profils

| Fonction JS | Requête | Accès | Réponse |
| --- | --- | --- | --- |
| `fetchMyProfile(userId)` | `profiles` : `select id, username, is_public, showcase_card_id, created_at, accepts_trades` `id = userId` | connecté | La ligne du joueur (`accepts_trades: true` ajouté si la colonne n'existe pas encore) |
| `updateMyProfile(userId, fields)` | `update` de ces seules colonnes | connecté, son profil | Ligne mise à jour. Pseudo pris → code Postgres `23505`, traduit en `{ code: 'taken' }` par le store. Vitrine non possédée → `showcase card must be one you own` |
| `searchUsernames(prefix, { excludeId, limit = 8 })` | `profiles` `ilike '<prefix>%'`, `is_public`, sans `excludeId` (soi), trié par pseudo | connecté | `[{ username, accepts_trades }]` (`accepts_trades` lu à `true` avant 0012). Autocomplétion du partenaire d'échange ; la RLS ne laisse passer que les profils publics |
| `fetchPublicProfile(username)` | `profiles` `ilike username` (casse ignorée, `_` et `%` échappés) | public | Le profil, ou `null` s'il est privé ou inconnu (la RLS le cache) |

### `public_collection(p_username text)`

JS : `fetchPublicCollection(username)`. Accès : public.
Collection **Illimité** d'un profil public (ou la sienne), sous forme
d'entrées de collection. Tableau vide si le profil est privé ou inconnu.

### `challenge_collection_of(p_username text)`

JS : `fetchChallengeCollectionOf(username)`. Accès : public.
Collection **Défi** d'un profil public (ou la sienne), plus un champ
`tradable` (faux = carte verrouillée hors échanges) :

```json
[{ "card_id": "base1-4", "quantity": 1, "acquired_at": "…", "cards": { "…" }, "tradable": true }]
```

---

## Communauté

### `leaderboard(p_kind text, p_limit int = 20)`

JS : `fetchLeaderboard(kind, limit)`. Accès : public. Profils publics
seulement, 100 lignes au maximum.

Chaque ligne : `{ rank, username, score, packs, card_id, card_name, image_small }`.

| `p_kind` | `score` | Détail |
| --- | --- | --- |
| `hit_rate` | Cartes ultra+secret pour 100 packs | Illimité, 20 packs minimum, `packs` renseigné |
| `best_pull` | Valeur (€) de la carte la plus chère possédée | Illimité, `card_*` renseignés |
| `complete_sets` | Nombre de sets complets | Illimité |
| `challenge_unique` | Cartes distinctes de la collection Défi | Égalité : moins de packs Défi ouverts = mieux classé |
| `challenge_value` | Valeur (€) de ces cartes distinctes | Idem |

Erreur : `unknown leaderboard …`.

Depuis 0022, le calcul vit dans `leaderboard_rows(p_kind)` (interne, non
appelable par les clients : toutes les lignes, avec `user_id`) ;
`leaderboard()` en prend les `p_limit` premières, résultats inchangés.

### `my_leaderboard_rank(p_kind text)` (0022)

JS : `fetchMyRank(kind)` (`null` si la migration manque ou en cas
d'erreur : pas de ligne « Toi »). Accès : connecté. La ligne du joueur
sur ce classement, même au-delà des 20 affichées :

```json
{ "public": true, "rank": 34, "score": 4.5, "packs": 60, "card_id": null, "card_name": null, "image_small": null }
```

`rank: null` = pas encore classé (`packs` = boosters Illimité ouverts, pour
les 20 qu'il faut à `hit_rate`) ; `{ "public": false }` = profil privé,
jamais classé. Erreurs : `not_authenticated`, `unknown leaderboard …`.

### Fil des gros tirages

- `fetchFeed(limit = 30, mode = null)` : `pull_feed` : `select id, username, card_id, card_name, image_small, bucket, set_id, mode, pulled_at order by pulled_at desc limit <limit>`, plus `mode = eq.<mode>` si `mode` est donné (`'challenge'` | `'unlimited'` : le switch de Communauté ; l'accueil prend les deux modes). Public (profils publics seulement).
- `subscribeToFeed(onPull)` : canal Realtime `pull-feed`, événement `INSERT` sur `public.pull_feed`. `onPull` reçoit la nouvelle ligne.

---

## Succès

### `player_achievements(p_mode text, p_username text = null)`

JS : `fetchPlayerAchievements(mode, username?)`. Accès : public.
Sans pseudo : les données du joueur connecté ; avec : celles d'un profil
public (`null` s'il est privé ou inconnu).

```json
{
  "unlocked": ["boosters1", "boosters10", "unique10"],
  "packs": 42,
  "stats": {
    "packs": 42, "first_at": "2026-09-12T…", "hit_packs": 8, "hits": 9, "secrets": 1,
    "max_hits": 2, "god_packs": 0, "sets": 6, "days": 5, "today": 3,
    "best_day": 15, "best_streak": 3, "top_set_id": "sv3pt5", "top_set_packs": 20,
    "trades": 1, "gifts": 0, "coins_earned": 1850, "missions": 7,
    "crafted": 2, "recycled": 60, "best_daily_streak": 4
  }
}
```

- `unlocked` : ids déjà enregistrés (ils restent débloqués).
- `packs` : packs ouverts dans ce mode (`booster_openings`).
- `stats` : statistiques exactes des packs ; les 7 dernières clés
  n'existent qu'en Défi. Jours = jours UTC.

Erreur : `invalid_mode`.

### `record_achievements(p_ids text[], p_mode text = 'unlimited')`

JS : `recordAchievements(ids, mode)`. Accès : connecté. Ajoute les ids
débloqués (jamais de retrait) ; renvoie **le nombre d'ids nouveaux**.
Erreurs : `invalid_mode`, `too_many_achievements` (> 500).

### `achievement_rates(p_mode text = 'unlimited')`

JS : `fetchAchievementRates(mode)`. Accès : public.
Lignes `{ achievement_id, holders, players }` ; `players` = comptes qui
possèdent au moins une carte dans ce mode. Le JS le transforme en
`{ players, holders: { [id]: n } }`.

---

## Mode Défi

Toutes ces RPC exigent d'être connecté, **verrouillent le portefeuille du
joueur** avant tout, et le créent avec 1000 pièces si besoin (sauf
`challenge_badge`, en lecture seule). Le client n'envoie **jamais de
montant** : seulement ce qu'il veut faire.

### `challenge_state()`

JS : `fetchChallengeState()`.

```json
{
  "coins": 1250,
  "daily_streak": 3,
  "daily_available": true,
  "daily_reward": 350,
  "today": "2026-09-27",
  "missions": [
    { "mission": "open_packs", "target": 3, "reward": 75, "progress": 1, "claimed": false },
    { "mission": "pull_holo", "target": 1, "reward": 100, "progress": 1, "claimed": false },
    { "mission": "recycle", "target": 5, "reward": 50, "progress": 0, "claimed": false }
  ],
  "weekly": [
    { "mission": "week_open_packs", "target": 25, "reward": 400, "progress": 12, "claimed": false },
    { "mission": "week_pull_ultra", "target": 2, "reward": 400, "progress": 1, "claimed": false },
    { "mission": "week_recycle", "target": 50, "reward": 250, "progress": 20, "claimed": false },
    { "mission": "week_daily", "target": 5, "reward": 300, "progress": 3, "claimed": false }
  ],
  "week_start": "2026-09-21"
}
```

`daily_reward` = ce que rapporterait la réclamation d'aujourd'hui.

### `claim_daily_reward()`

JS : `claimDailyReward()`. Crédite 200 pièces, +50 par jour consécutif,
500 au maximum (dès le 7e jour). Un jour manqué remet la série à 1.
Réponse : `challenge_state()` + `"reward": 350`. Erreur : `already_claimed`.

### `claim_mission(p_mission text)`

JS : `claimMission(id)`. Accepte les ids quotidiens et hebdomadaires.
Réponse : `challenge_state()` + `reward`.
Erreurs : `unknown_mission`, `already_claimed`, `mission_incomplete`.

### `open_challenge_booster(p_set_id text = null)`

JS : `openChallengeBooster(setId)`. Paie 100 pièces, tire un pack normal
ou, 1 fois sur 500, un **pack divin** (6 holo, 3 ultra, 1 secret du même
set), puis le sauvegarde comme en Illimité (collection Défi, journal, fil).

```json
{ "cards": [ "…10 cartes…" ], "coins": 1150, "god_pack": false }
```

Erreurs : `not_enough_coins`, limite de 60 packs/minute.

### `recycle_duplicates(p_card_id text = null)`

JS : `recycleDuplicates(cardId?)`. Vend tous les exemplaires au-delà du
premier, d'une carte ou de toutes (`null`). Barème par rareté : 1, 2, 5,
15, 60, 200 pièces (commune → secrète).

```json
{ "recycled": 12, "gained": 47, "coins": 1197 }
```

### `recycle_cards(p_card_ids text[])` (0017)

JS : `recycleCards(cardIds)` (via `challenge.recycle([ids])`). Même chose
que `recycle_duplicates`, mais seulement pour les cartes choisies (un
exemplaire de chacune est gardé ; ids inconnus, non possédés ou sans
doublon ignorés ; `null` ou `{}` = rien). Une ligne `recycle` au journal
(avec l'id de la carte si une seule). Même réponse. Avant 0017
(`PGRST202`), le client appelle `recycle_duplicates` carte par carte et
additionne.

### `recycle_card_copies(p_picks jsonb)` (0020)

JS : `recycleCopies(picks, extras)` (via `challenge.recycle({ picks,
extras })`). `p_picks` = objet `{ "id de carte": exemplaires }`, par ex.
`{ "sv3pt5-4": 2 }` : recycle ce nombre d'exemplaires de chaque carte,
plafonné à ses doublons (un exemplaire est toujours gardé) ; nombres ≤ 0,
non numériques, ids inconnus, non possédés ou sans doublon ignorés ; `null`
ou autre chose qu'un objet = rien. Même barème, même verrou du
portefeuille, une ligne `recycle` au journal (avec l'id si une seule
carte). Même réponse. Avant 0020 (`PGRST202`) : si chaque carte prend tous
ses doublons, le client passe par `recycle_cards`, sinon erreur
`recycle_copies_unavailable`.

### `craft_card(p_card_id text)`

JS : `craftCard(cardId)`. Achète un exemplaire d'une carte. Prix par
rareté : 20, 40, 100, 300, 1500, 5000 pièces.

```json
{ "card_id": "sv3pt5-199", "quantity": 1, "price": 5000, "coins": 250 }
```

Erreurs : `unknown_card`, `not_enough_coins`.

### `challenge_badge()`

JS : `fetchChallengeBadge()`. Ce qui attend le joueur, pour le badge de
navigation, **sans créer de portefeuille** :
`{ "rewards": 2, "trades": 1, "answers": 1 }` (récompense quotidienne +
missions finies non réclamées ; offres reçues en attente ; réponses à mes
offres pas encore vues, depuis 0017, 0 avant côté client).

---

## Échanges (Défi)

| RPC | JS | Réponse | Erreurs |
| --- | --- | --- | --- |
| `propose_trade(p_username, p_offer text[], p_request text[] = '{}')` | `proposeTrade(name, offerIds, requestIds)` | id de la nouvelle offre | `trainer_not_found` (inconnu ou privé), `cannot_trade_with_yourself`, `trades_closed` (le joueur refuse les échanges), `invalid_trade` (1–5 cartes offertes, 0–5 demandées, sans doublon), `cards_not_owned`, `card_not_for_trade` (carte verrouillée d'un côté ou de l'autre), `too_many_trades` (10 offres en attente maximum) |
| `respond_trade(p_trade_id, p_accept bool)` | `respondTrade(id, accept)` | `{ "status": "accepted" \| "declined" \| "failed" }`. `failed` = une carte n'est plus possédée, ou l'expéditeur a verrouillé une carte offerte entre-temps | `trade_not_found` (pas le destinataire), `trade_closed`, `trade_expired` (7 jours) |
| `counter_trade(p_trade_id, p_offer text[], p_request text[] = '{}')` (0021) | `counterTrade(id, offerIds, requestIds)` | id de la contre-offre (envoyée à l'expéditeur de l'offre, `counter_of` = son id) ; l'offre d'origine passe en `countered` (vue d'office) | `trade_not_found` (pas le destinataire), `trade_closed`, `trade_expired`, puis les mêmes que `propose_trade` sauf `trades_closed` (il a fait la première offre). Sans la migration : `counter_unavailable` côté client |
| `cancel_trade(p_trade_id)` | `cancelTrade(id)` | — | réservé à l'expéditeur, offre en attente |
| `card_traders(p_card_id)` (0022) | `fetchCardTraders(cardId)` | `[{ "username": "Misty", "quantity": 3 }]` : joueurs publics qui acceptent les échanges, ont au moins 2 exemplaires de la carte en Défi et ne l'ont pas verrouillée ; jamais soi-même, 20 au maximum, les plus fournis d'abord. `null` côté client si la migration manque | `not_authenticated` |
| `my_trades()` | `fetchTrades()` | Les 50 dernières offres, dans les deux sens (voir ci-dessous) | — |
| `mark_trade_answers_seen()` (0017) | `markTradeAnswersSeen()` | Nombre de réponses marquées vues (celles des offres du joueur). 0 si la migration manque | `not_authenticated` |

```json
[{
  "id": 42, "direction": "received", "partner": "Misty",
  "offer": [ "…cartes données par l'expéditeur…" ], "request": [ "…cartes demandées…" ],
  "status": "pending", "unseen": false, "created_at": "…", "resolved_at": null
}]
```

`status` vaut `expired` pour une offre en attente de plus de 7 jours.
`unseen` (0017) : une réponse à une de mes offres que je n'ai pas encore vue.

**Verrous** (table `trade_locks`, écrite par le client) :
`fetchTradeLocks()` → `select card_id` ; `lockCard(id)` → `insert` ;
`unlockCard(id)` → `delete`.

**Temps réel** : `subscribeToTrades(userId, onChange)` ouvre le canal
`trades-<userId>` sur tous les événements de `public.trade_offers` ; la RLS
filtre, chacun ne reçoit que ses offres.

---

## Mini-jeu « Plus ou moins » (Défi, migration 0013)

| RPC | JS | Rôle |
| --- | --- | --- |
| `minigame_state()` | `fetchMinigameState()` | Règles, parties payées restantes, record, partie en cours (reprise après rechargement). Clôt une question expirée |
| `minigame_start()` | `startMinigame()` | Abandonne la partie en cours et en démarre une (20 par minute au maximum, sinon `slow_down`). Renvoie l'état |
| `minigame_answer(p_pick)` | `answerMinigame(pick)` | `'left'`, `'right'`, ou `null` (temps écoulé). Renvoie les deux prix + l'état suivant |

État (`minigame_state`) :

```json
{
  "paid_runs": 3, "coins_per_answer": 5, "max_paid_answers": 20, "answer_seconds": 15,
  "coins": 1300, "paid_left": 2, "today_coins": 35, "best": 14,
  "run": {
    "paid": true, "streak": 4, "coins": 20, "seconds_left": 12,
    "left":  { "id": "…", "name": "…", "rarity": "…", "image_small": "…", "image_url": "…", "set_id": "…", "set_name": "…" },
    "right": { "…même forme, jamais de prix…" }
  }
}
```

Réponse (`minigame_answer`) :

```json
{
  "correct": true, "late": false, "earned": 5, "streak": 5, "run_coins": 25,
  "left": { "id": "…", "value": 12.4 }, "right": { "id": "…", "value": 3.1 },
  "state": { "…minigame_state()…" }
}
```

Erreurs : `no_game` (aucune partie en cours), `invalid_pick`,
`slow_down`, `minigame_unavailable` (pas assez de cartes avec un prix).
Si la RPC n'existe pas (migration non appliquée, `PGRST202`), le store
passe en `unavailable` et le jeu affiche « Bientôt ».

---

## Mini-jeu « Électrode Shiny Flip » (Défi, migration 0014)

| RPC | JS | Rôle |
| --- | --- | --- |
| `electrode_flip_state()` | `fetchElectrodeFlipState()` | Règles, niveau, pièces gagnées et restantes aujourd'hui, records, plateau en cours |
| `electrode_flip_start()` | `startElectrodeFlip()` | Distribue un plateau au niveau du joueur, ou renvoie celui en cours (jamais abandonné : ce serait esquiver une défaite). 20 par minute au maximum (`slow_down`). Renvoie l'état |
| `electrode_flip_flip(p_index)` | `flipElectrodeTile(index)` | Retourne la case 0..24 (ligne par ligne). Finit le plateau sur un Électrode (perdu) ou quand tous les 2 et 3 sont retournés (gagné, payé) |
| `electrode_flip_cash_out()` | `cashOutElectrodeFlip()` | Termine le plateau en gardant ses points (au moins une case retournée) |

État (`electrode_flip_state`) :

```json
{
  "levels": 5, "daily_coins": 300,
  "coins": 1300, "level": 2, "today_coins": 48, "coins_left": 252,
  "best_points": 72, "best_level": 1,
  "board": {
    "level": 2, "points": 6, "flips": 3, "status": "playing",
    "rows": [{ "points": 5, "electrodes": 1 }, "…5 lignes…"],
    "cols": [{ "points": 6, "electrodes": 1 }, "…5 colonnes…"],
    "tiles": [null, 1, 2, null, "…25 cases : null tant que cachée…"],
    "flipped": [false, true, true, false, "…"]
  }
}
```

Réponse (`electrode_flip_flip`, `electrode_flip_cash_out`) :

```json
{
  "index": 7, "value": 3, "earned": 0,
  "result": { "…le plateau après coup ; toutes les cases une fois fini…" },
  "state": { "…electrode_flip_state()…" }
}
```

(`index` et `value` seulement pour `flip` ; `value` 0 = Électrode.)
Erreurs : `no_game`, `invalid_tile`, `already_flipped`,
`nothing_to_cash`, `slow_down`. RPC absente (`PGRST202`) → store
`unavailable`, « Bientôt ».

---

## Mini-jeu « Super efficace ! » (Défi, migration 0015)

| RPC | JS | Rôle |
| --- | --- | --- |
| `super_effective_state()` | `fetchSuperEffectiveState()` | Règles, `ready` (des cartes ont leurs faiblesses), parties payées restantes, pièces du jour, record, partie en cours. Ferme une partie dont la question a expiré |
| `super_effective_start()` | `startSuperEffective()` | Abandonne la partie en cours et en démarre une (payée s'il en reste). 20 par minute au maximum (`slow_down`). Renvoie l'état |
| `super_effective_answer(p_pick)` | `answerSuperEffective(pick)` | Un type parmi `options` (`null` = temps écoulé). Renvoie le résultat, la bonne réponse et l'état suivant |

État (`super_effective_state`) :

```json
{
  "paid_runs": 3, "coins_per_answer": 5, "max_paid_answers": 20, "answer_seconds": 10,
  "ready": true, "coins": 1250, "paid_left": 2, "today_coins": 15, "best": 9,
  "run": {
    "paid": true, "streak": 3, "coins": 15, "seconds_left": 8,
    "card": { "id": "…", "name": "Charmander", "types": ["Fire"], "hp": 70, "image_small": "…", "image_url": "…", "set_id": "…", "set_name": "…" },
    "options": ["Grass", "Water", "Psychic"]
  }
}
```

Réponse (`super_effective_answer`) :

```json
{
  "correct": false, "late": false, "earned": 0, "streak": 3, "run_coins": 15,
  "answer": "Water", "weaknesses": ["Water"],
  "state": { "…super_effective_state()…" }
}
```

Erreurs : `no_game`, `invalid_pick` (type non proposé), `slow_down`,
`super_effective_unavailable` (aucune carte avec une faiblesse : l'import
n'est pas repassé). RPC absente (`PGRST202`) ou `ready: false` → store
`unavailable`, « Bientôt ».

---

## Mini-jeu « Chaîne d'évolution » (Défi, migration 0018)

| RPC | JS | Rôle |
| --- | --- | --- |
| `evolution_chain_state()` | `fetchEvolutionChainState()` | Règles, `ready` (une lignée complète existe), parties payées restantes, pièces du jour, record, partie en cours. Ferme une partie dont la question a expiré |
| `evolution_chain_start()` | `startEvolutionChain()` | Abandonne la partie en cours et en démarre une (payée s'il en reste). 20 par minute au maximum (`slow_down`). Renvoie l'état |
| `evolution_chain_answer(p_order)` | `answerEvolutionChain(order)` | `run.length` ids distincts parmi `cards` (3 avant 0019), carte de base en premier (`null` = temps écoulé). Renvoie le résultat, le bon ordre et l'état suivant |
| `evolution_chain_stop()` (0019) | `stopEvolutionChain()` | Termine la partie en cours (`stopped`) : les pièces gagnées restent, la série compte pour le record. Renvoie `{ streak, run_coins, state }` |

État (`evolution_chain_state`) :

```json
{
  "paid_runs": 3, "coins_per_answer": 3, "max_paid_answers": 20, "answer_seconds": 15,
  "ready": true, "coins": 1250, "paid_left": 2, "today_coins": 9, "best": 7,
  "run": {
    "paid": true, "streak": 3, "coins": 9, "seconds_left": 12, "length": 3,
    "cards": [
      { "id": "sv3pt5-6", "name": "Charizard ex", "image_small": "…" },
      { "id": "sv3pt5-4", "name": "Charmander", "image_small": "…" },
      { "id": "sv3pt5-5", "name": "Charmeleon", "image_small": "…" }
    ]
  }
}
```

Réponse (`evolution_chain_answer`) :

```json
{
  "correct": false, "late": false, "earned": 0, "streak": 3, "run_coins": 9,
  "chain": ["sv3pt5-4", "sv3pt5-5", "sv3pt5-6"],
  "state": { "…evolution_chain_state()…" }
}
```

`length` (0019) : nombre de cartes à ordonner, 2 ou 3 (absent avant
0019 : toujours 3).

Erreurs : `no_game` (aussi pour `stop` sans partie), `invalid_pick` (pas
`length` cartes distinctes parmi celles montrées), `slow_down`, `evolution_chain_unavailable` (aucune lignée
complète : l'import n'est pas repassé). RPC absente (`PGRST202`) ou
`ready: false` → store `unavailable`, « Bientôt ».

---

## Combats PvP (Défi, migrations 0024 + 0025 + 0026 + 0027)

| RPC | JS | Rôle |
| --- | --- | --- |
| `pvp_state()` | `fetchPvpState()` | Règles, `ready` (des cartes ont leurs attaques et les sets leur ère), combats restants du jour, formats avec mes cartes jouables, mes decks (`{ format: { attack, defense } }` depuis 0026, chacun `{ cards, valid }` ou absent ; `valid` : toutes les cartes encore possédées ; avant 0026 un seul `{ cards, valid }` par format, que `deckRoles()` lit comme le deck d'attaque), mes Elo par format, combat en cours, mes 10 derniers combats (attaques, défenses et bots, de mon point de vue ; un combat contre un bot a `bot` et `coins`). Depuis 0027 : `battles_left` ne compte que les combats contre des joueurs, plus `bot_battles_left`, `bot_paid_left`, `coins` (portefeuille) et les règles `bot_levels`, `bot_coins`, `bot_paid_per_day`, `bot_battles_per_day` |
| `pvp_eligible(p_format)` | `fetchPvpEligible(format)` | Mes cartes du Défi jouables dans ce format, meilleure attaque d'abord |
| `pvp_save_deck(p_format, p_cards, p_role)` (0026 ; sans `p_role` avant) | `savePvpDeck(format, ids, role)` | `role` = `attack` (par défaut) ou `defense` (sinon `pvp_invalid_role`). 5 ids distincts, possédés, jouables, du format ; une carte peut être dans les deux decks. Crée mon Elo du format. Renvoie l'état. Sans 0026 : le deck d'attaque est enregistré à l'ancienne, un deck de défense donne `pvp_roles_unavailable` (côté client) |
| `pvp_start(p_format)` | `startPvpBattle(format)` | Renvoie le combat en cours s'il y en a un ; sinon attaque avec **mon deck d'attaque** (`pvp_no_deck` sans lui) : tire un adversaire parmi les 5 joueurs d'Elo le plus proche ayant un deck valide (**son deck de défense**, sinon son deck d'attaque ; le dernier adversaire en dernier) et démarre. Renvoie l'état |
| `pvp_bot_start(p_format, p_level)` (0027) | `startPvpBotBattle(format, level)` | Renvoie le combat en cours s'il y en a un ; sinon combat contre un bot (`easy`, `normal`, `hard`, sinon `pvp_invalid_level`) avec **mon deck d'attaque** (`pvp_no_deck`, `pvp_invalid_deck`) : le serveur tire le deck du bot dans tout le format (`pvp_no_bot_deck` s'il n'y a pas 5 noms différents). Pas d'Elo ; payant si c'est un des 5 premiers combats contre les bots du jour, 20 par jour (`pvp_no_bot_battles_left`). Renvoie l'état. Sans 0027 : `pvp_bots_unavailable` (côté client) |
| `pvp_play(p_slot, p_attack)` (0025 ; `pvp_play(p_slot)` avant) | `playPvpCard(slot, attack)` | Joue ma carte (0-4) avec une de ses attaques (index dans `attacks`, `null` = pas d'attaque, l'énergie est gardée) contre la carte et l'attaque déjà choisies du défenseur. Renvoie `{ round, battle, state }` |
| `pvp_forfeit()` | `forfeitPvpBattle()` | Abandon = défaite (Elo ; contre un bot : 0 pièce). Renvoie `{ battle, state }` |
| `pvp_leaderboard(p_format)` | `fetchPvpLeaderboard(format)` | Top 20 des profils publics ayant combattu (attaques + défenses), et ma ligne (`me`, `null` si pas classé) |

Format : `all`, `era:<sets.series>` ou `set:<id>` (un sous-set n'est pas
un format : ses cartes comptent pour son parent).

Carte (instantané `pvp_card()`) :

```json
{ "id": "sv3pt5-6", "name": "Charizard ex", "image_small": "…", "hp": 330,
  "types": ["Darkness"], "weaknesses": ["Grass"], "resistances": [], "prizes": 2,
  "attacks": [{ "name": "Burning Darkness", "damage": 180, "times": false, "cost": 3 }] }
```

`attacks` = les attaques qui font des dégâts, la moins chère d'abord ;
`cost` = nombre d'énergies (5 au maximum) ; `prizes` = récompenses données
au K.O. (1, 2 pour ex/EX/GX/V/VSTAR/LEGEND, 3 pour VMAX/TAG TEAM/V-UNION/Méga
ex).

Combat (`battle`, vue de l'attaquant) :

```json
{
  "id": 12, "format": "era:Scarlet & Violet", "status": "playing", "round": 2,
  "my_prizes": 1, "their_prizes": 0, "my_energy": 2, "their_energy": 1, "elo_change": null,
  "opponent": { "username": "Misty", "elo": 1016 },
  "mine": [{ "…carte…": "", "slot": 0, "hp_left": 150 }],
  "theirs": { "left": 4, "seen": [{ "…carte…": "", "slot": 3, "hp_left": 0 }], "deck": null },
  "log": [{ "a": 0, "d": 3, "a_attack": 0, "d_attack": null, "dealt": 180, "taken": 0, "roll_a": null, "roll_d": null, "ko_theirs": true, "ko_mine": false }]
}
```

Depuis 0027, le combat a aussi `bot` (niveau, `null` contre un joueur),
`paid` et `coins` (pièces gagnées, à la fin), et `opponent.bot`. Contre un
bot : `opponent.username` et `opponent.elo` sont `null`, `elo_change`
vaut 0 à la fin. `opponent.username` est `null` pour un profil privé. `theirs.deck` (tout
le deck adverse) n'arrive qu'à la fin du combat, la prochaine carte du
défenseur jamais. `a_attack` / `d_attack` = index de l'attaque (`null` =
pas d'attaque). `roll_*` = le tirage 1 à 3 d'une attaque « 20× ».

Erreurs : `pvp_invalid_format`, `pvp_invalid_deck`, `pvp_no_deck`,
`pvp_no_opponent` (aucun autre deck valide dans ce format),
`pvp_no_battles_left` (10 par jour de jeu), `pvp_invalid_card` (emplacement
inconnu ou carte K.O.), `pvp_invalid_attack` (attaque inconnue),
`pvp_not_enough_energy` (attaque trop chère pour la réserve), `no_game` (jouer / abandonner sans combat). RPC
absente (`PGRST202`) ou `ready: false` → store `unavailable`, « Bientôt ».

---

## Import des cartes (admin)

`scripts/populate.mjs` utilise la clé **service role** et fait des `upsert`
dans `sets`, `cards` et `card_price_history`, puis appelle la RPC
`link_subsets()` (réservée au service role), qui renvoie le nombre de
sous-sets reliés. Voir [Outillage](06-outillage.md#3-import-des-cartes).
