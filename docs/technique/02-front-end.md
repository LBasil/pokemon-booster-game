# 2. Front-end

[← Vue d'ensemble](01-vue-d-ensemble.md) · [Sommaire](README.md) · Suivant : [Base de données →](03-base-de-donnees.md)

Le front-end est une SPA Vue 3 construite par Vite. Chaque couche a un
rôle précis, et les dépendances vont toujours dans le même sens :

```
views/  ──►  stores/ + composables/  ──►  api/  ──►  lib/supabaseClient.js
   └──────────────►  utils/ (fonctions pures, utilisables partout)
```

- une **vue** affiche et réagit aux clics ; elle reste mince ;
- un **store** détient l'état partagé et les indicateurs de chargement
  (`loading`, `loaded`, `error`) ;
- un fichier **api/** n'est qu'un mince emballage autour d'un appel
  supabase-js : il ne garde aucun état ;
- un **utilitaire** (`utils/`) est une fonction pure, testée par Vitest.

---

## 1. Démarrage

[src/main.js](../../src/main.js) crée l'app, branche Pinia, le routeur et
l'i18n, applique le thème sauvegardé (`useThemeStore().init()`), prépare la
PWA (`setupPwa()`) et, en production seulement, surveille les nouveaux
déploiements (`watchAppVersion()`).

[src/App.vue](../../src/App.vue) :

- initialise la session (`auth.init()`) ;
- dès qu'un joueur est connecté, écoute ses échanges en direct
  (`useTradesStore().live(userId)`) et arrête à la déconnexion ;
- rend la page courante avec `<RouterView>`, **clé = nom de la route**.
  `/boosters` et `/challenge/boosters` utilisent le même composant mais ne
  doivent pas partager la même instance (état, stores de mode différents) ;
- monte une fois pour toutes `AchievementToasts` (notifications de succès)
  et `PointerFx` (étincelles au clic / tap) ;
- pose la classe `pb-fx-off` sur `<html>` quand le joueur coupe les effets
  visuels.

Le client Supabase est créé une seule fois dans
[src/lib/supabaseClient.js](../../src/lib/supabaseClient.js) à partir de
`VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`. Sans ces variables, il
utilise une adresse bidon pour ne pas planter (tests, build) et affiche un
avertissement dans la console.

---

## 2. Routes et navigation

Toutes les routes sont dans [src/router/index.js](../../src/router/index.js).
Chaque page est un *chunk* chargé à la demande
(`component: () => import(...)`).

### Table des routes

| Chemin | Nom | Vue | Accès | Mode |
| --- | --- | --- | --- | --- |
| `/` | `home` | `HomeView` | public (connecté → redirigé vers `/game`) | — |
| `/game` | `game` | `GameHubView` | connecté | illimité |
| `/boosters` | `boosters` | `BoosterView` | connecté | illimité |
| `/collection` | `collection` | `CollectionView` | connecté | illimité |
| `/collection/set/:setId` | `binder` | `SetBinderView` | connecté | illimité |
| `/history` | `history` | `HistoryView` | connecté | illimité |
| `/achievements` | `achievements` | `AchievementsView` | connecté | illimité |
| `/profile` | `profile` | `ProfileView` | connecté | partagé |
| `/community` | `community` | `CommunityView` | connecté | partagé |
| `/challenge` | `challenge` | `ChallengeView` | connecté | défi |
| `/challenge/boosters` | `challenge-boosters` | `BoosterView` (`mode: 'challenge'`) | connecté | défi |
| `/challenge/collection` | `challenge-collection` | `CollectionView` (`mode`) | connecté | défi |
| `/challenge/collection/set/:setId` | `challenge-binder` | `SetBinderView` (`mode`) | connecté | défi |
| `/challenge/history` | `challenge-history` | `HistoryView` (`mode`) | connecté | défi |
| `/challenge/achievements` | `challenge-achievements` | `AchievementsView` (`mode`) | connecté | défi |
| `/challenge/games` | `challenge-games` | `GamesView` | connecté | défi |
| `/challenge/games/higher-lower` | `challenge-game-higher-lower` | `MinigameView` | connecté | défi |
| `/challenge/minigame` | — | redirige vers le mini-jeu | — | — |
| `/challenge/games/electrode-flip` | `challenge-game-electrode-flip` | `ElectrodeFlipView` | connecté | défi |
| `/challenge/games/super-effective` | `challenge-game-super-effective` | `SuperEffectiveView` | connecté | défi |
| `/challenge/games/evolution-chain` | `challenge-game-evolution-chain` | `EvolutionChainView` | connecté | défi |
| `/challenge/games/pvp` | `challenge-game-pvp` | `PvpView` | connecté | défi |
| `/challenge/trades` | `challenge-trades` | `TradesView` | connecté | défi |
| `/u/:username` | `public-profile` | `ProfileView` (`username` en prop) | **public** | partagé |
| `/u/:username/achievements` | `public-achievements` | `AchievementsView` | **public** | partagé |
| `/reset-password` | `reset-password` | `ResetPasswordView` | public | — |
| tout le reste | `not-found` | `NotFoundView` | public | — |

### La garde (`router.beforeEach`)

À chaque navigation, dans cet ordre :

1. **Nouveau déploiement détecté ?** Si `hasUpdate()` est vrai et que le
   chemin change vraiment (pas seulement les paramètres d'URL), le routeur
   fait un rechargement complet vers la page demandée. Voir
   [§ 9 PWA et versions](#9-pwa-service-worker-et-nouvelles-versions).
2. Attend que la session soit connue (`auth.init()` au premier passage).
3. Page `requiresAuth` sans session → redirige vers `home`.
4. Page `home` avec une session → redirige vers `game`.

`router.onError` rattrape le cas où un vieil onglet demande un chunk qui
n'existe plus après un déploiement (`isChunkLoadError`) : il recharge la
page cible **une fois** (garde-fou de 10 s en `sessionStorage` pour ne pas
boucler hors ligne).

### Les modes dans le routeur ([src/router/modes.js](../../src/router/modes.js))

- `meta.mode: 'challenge'` marque une page du Défi.
- `meta.sharedMode: true` marque une page commune aux deux modes
  (communauté, profils). Elle **garde le mode d'où vient le joueur** :
  `router.afterEach(trackMode)` retient le dernier mode visité (dans
  `sessionStorage`, par onglet), et `routeMode(route)` le renvoie.
- `modeRoutes(mode)` donne les noms de routes d'un mode (`hub`, `boosters`,
  `collection`, `binder`, `history`, `achievements`). Les vues partagées
  s'en servent pour que leurs liens restent dans le bon mode.

Priorité produit : **le joueur ne doit jamais perdre de vue dans quel mode
il est**. Toutes les pages du Défi affichent la bande de mode d'`AppHeader`
(« Mode Défi », pièces, « Quitter »). Les tests
`e2e/navigation.spec.js` le vérifient.

### L'en-tête ([AppHeader.vue](../../src/components/AppHeader.vue))

Toute page connectée commence par `<div class="pb-page"><AppHeader />`.
L'en-tête contient :

- **sur ordinateur (≥ 992 px)** : le logo (lien vers le hub), les onglets
  de navigation, la langue et le thème ;
- **sur téléphone et tablette** : une barre d'onglets fixée en bas.
  `.pb-page` réserve la place ;
- **dans le Défi** : les liens Boosters/Collection mènent aux versions
  Défi, l'onglet « Mini-jeux » remplace Accueil, et la bande de mode
  s'affiche ;
- un **badge** sur les liens du Défi : récompenses à réclamer + offres
  d'échange en attente (`useChallengeStore().badge`) ;
- `PARENTS` : les pages sans lien propre allument celui de leur parent
  (un classeur allume Collection, un mini-jeu allume Mini-jeux…).

---

## 3. Stores Pinia

Tous dans [src/stores/](../../src/stores/). Motif commun : `load({ force })`
ne recharge pas si c'est déjà chargé (sauf `force`), et expose `loading`,
`loaded`, `error`.

> **Règle** : « à rafraîchir » ≠ « pas chargé ». Les vues affichent un
> squelette tant que `loaded` est faux. On ne remet donc jamais `loaded` à
> `false` pour signaler des données périmées : on utilise un drapeau
> `stale` et un `load({ force: true })` en arrière-plan. (Remettre `loaded`
> à faux a déjà fait disparaître tout le hub du Défi.)

| Store | Contient | Chargé par | Remarques |
| --- | --- | --- | --- |
| `auth` | `session`, `user`, `isLoggedIn`, `displayName` de secours | `App.vue`, garde du routeur | `signUp`, `signIn`, `signOut`, `requestPasswordReset`, `updatePassword` ; `hasAccountOnDevice()` (onglet par défaut de l'accueil). **Vide tous les stores du joueur** à la déconnexion ou au changement de compte (`resetPlayerStores`) |
| `profile` | La ligne `profiles` du joueur | vues qui affichent le pseudo | `update(fields)` ; lève `{ code: 'taken' }` si le pseudo est pris |
| `collection` / `challenge-collection` | `entries` (cartes possédées + détails), `stats` | `useModeCollectionStore(mode)` | Deux stores créés par la même fabrique, un par mode. `invalidate()` après une ouverture |
| `sets` | Les 176 sets, `byId` | presque toutes les vues | Chargé une fois ; les appels simultanés partagent la même requête |
| `wishlist` | Cartes recherchées (Illimité) | collection, boosters | `toggle(card)` ; le serveur retire la carte quand elle est tirée |
| `challenge` | `challenge_state()` : pièces, récompense quotidienne, missions ; `badge` | pages du Défi, en-tête | `openBooster`, `claimDaily`, `claimMission`, `recycle`, `craft`. `stale` après un pack (missions à recompter) |
| `trades` | Offres d'échange, cartes verrouillées, toasts d'échange | `TradesView`, `App.vue` (direct), `AchievementToasts` | `propose`, `respond`, `counter` (0021), `cancel`, `toggleLock` (optimiste), `live(userId)`, `markSeen` |
| `minigame` | État de « Plus ou moins » | page du jeu, hub des jeux | `unavailable` si la migration 0013 manque ; répercute le solde de pièces dans `challenge` |
| `electrodeFlip` | État d'« Électrode Shiny Flip » : niveau, pièces restantes, records, plateau en cours | page du jeu, hub des jeux | `flip(index)`, `cashOut()` ; `unavailable` si la migration 0014 manque ; répercute le solde de pièces |
| `superEffective` | État de « Super efficace ! » : parties payées restantes, record, partie en cours | page du jeu, hub des jeux | `unavailable` si la migration 0015 manque **ou** si aucune carte n'a encore ses faiblesses (`ready: false`) ; répercute le solde de pièces |
| `pvp` | Combats PvP : decks d'attaque et de défense (`decks[format]` = `{ attack, defense }`, quelle que soit la version du serveur) et Elo par format, combats restants du jour, combat en cours, historique (attaques et défenses), cartes jouables par format (`eligible`), classements (`boards`) | page des combats, hub des jeux | `loadEligible(format)`, `saveDeck(format, ids, role)`, `start(format)`, `play(slot, attack)` (`attack` = index dans les attaques de la carte, `null` = pas d'attaque), `forfeit()`, `loadBoard(format)`, `startBot(format, level)` (0027 : combat contre un bot, `botsAvailable`, `botBattlesLeft`, `botPaidLeft` ; les pièces gagnées passent au portefeuille du store `challenge`) ; `bestElo` pour la tuile ; `unavailable` si la migration 0024 manque, si aucune carte n'a encore ses attaques (`ready: false`) **ou** si je ne suis pas testeur (0028 : `pvpOpenTo(pseudo du profil)`, vérifié avant d'appeler le serveur) ; remis à zéro au changement de compte |
| `evolutionChain` | État de « Chaîne d'évolution » : parties payées restantes, record, partie en cours | page du jeu, hub des jeux | `answer(order)`, `stop()` (sans la RPC de 0019 : la partie s'arrête à l'écran et expire côté serveur) ; `unavailable` si la migration 0018 manque **ou** si aucune lignée complète n'est encore connue (`ready: false`) ; répercute le solde de pièces |
| `achievements` | Toasts, taux par mode, données serveur par mode | `check(mode)` un peu partout | Voir [Parcours > Succès](05-parcours.md#7-succès) |
| `settings` | `sound`, `vibration`, `effects`, `animations`, `recycleKeep` (exemplaires gardés au recyclage, 1 à 4), `largeText` (texte agrandi : `html.pb-text-large`, posé par `App.vue`) | — | Par appareil (`localStorage`). `liteAnimations` = animations légères sur écran tactile en mode `auto` |
| `theme` | `isLight` | `main.js` | Pose `data-bs-theme` sur `<html>` (Bootstrap + tokens suivent) |

---

## 4. Couche `api/`

Un fichier par domaine dans [src/api/](../../src/api/). Chaque fonction
fait **un** appel supabase-js et renvoie `data`, ou lève l'erreur. Le détail
de chaque appel (paramètres, réponse, erreurs) est dans la
[Référence API](04-reference-api.md).

| Fichier | Fonctions |
| --- | --- |
| `boosters.js` | `openBooster(setId)` |
| `collection.js` | `fetchCollection(mode)`, `fetchCollectionStats(mode)` |
| `cards.js` | `fetchSetCards`, `fetchCardsByIds`, `fetchPokedexSize`, `fetchPriceHistory` |
| `sets.js` | `fetchSets`, `fetchPoolStats`, `fetchSetCover` |
| `profiles.js` | `fetchMyProfile`, `updateMyProfile`, `fetchPublicProfile`, `fetchPublicCollection`, `searchUsernames` |
| `history.js` | `fetchOpenings({ mode, before, limit, hitsOnly })` |
| `wishlist.js` | `fetchWishlist`, `addToWishlist`, `removeFromWishlist` |
| `social.js` | `LEADERBOARDS`, `fetchLeaderboard`, `fetchFeed`, `subscribeToFeed` |
| `achievements.js` | `recordAchievements`, `fetchAchievementRates`, `fetchPlayerAchievements` |
| `challenge.js` | tout le Défi : état, récompenses, packs, recyclage, fabrication, badge, échanges, verrous, mini-jeu, `subscribeToTrades` |

Deux mécanismes transversaux :

- **Tolérance aux migrations manquantes.** Plusieurs fonctions réessaient
  sans les colonnes ou paramètres récents quand Postgres répond « colonne
  inconnue » (`42703`), « fonction introuvable » (`PGRST202`) ou « table
  introuvable » (`PGRST205`). Un client déployé avant une migration
  continue donc de marcher.
- **Erreurs métier du Défi.** Les fonctions SQL lèvent des messages courts
  (`not_enough_coins`, `trade_closed`…). `api/challenge.js` les reconnaît
  (liste `CHALLENGE_ERRORS`) et lève une `Error` avec `code` = ce message ;
  les vues l'affichent via la clé i18n `challenge.errors.<code>`.

---

## 5. Composables

| Composable | Rôle |
| --- | --- |
| [useModeAchievements(mode, username?)](../../src/composables/useModeAchievements.js) | Les succès d'un joueur dans un mode, **les siens** (stores) ou **ceux d'un profil public** (chargés). Expose aussi `entries` (la collection de ce mode) et `server` (données de `player_achievements`) : le profil en tire ses statistiques |
| [useGames()](../../src/composables/useGames.js) | La liste des mini-jeux (`utils/games.js`) avec leur statut du jour, pour la page des jeux et la tuile du hub du Défi |
| [useAchievementText()](../../src/composables/useAchievementText.js) | Titre et description traduits d'un succès |

---

## 6. Utilitaires (`src/utils/`)

Fonctions pures, chacune testée dans un `*.test.js` voisin.

| Fichier | Contenu principal |
| --- | --- |
| `rarity.js` | `rarityBucket(label)` (**miroir** de `rarity_bucket()` en SQL), `BUCKETS`, `rarityTier` (3 niveaux visuels), `rarityRank`, `sortForReveal`, `bestPull` |
| `collection.js` | `filterEntries` (la recherche compare aussi le nom français du Pokémon : `cardNameMatches`, `searchNeedle`), `sortEntries`, `setProgress`, `collectionStats` (cartes, uniques, sets, valeur), `binderSlots`, `pokedexSlots`, `cardNumber` |
| `profile.js` | `boostersOpened`, `packSummary` (nombre exact de boosters par mode), `RANKS` + `rankFor` (niveau), `rarityBreakdown`, `validateUsername` |
| `achievements.js` | Les ~1210 définitions (`REGION_FOCUS` : une boucle par catégorie ajoute les succès de chaque fichier de région) (catégorie, `sub` = sous-catégorie, `tags` = régions du filtre), `collectorStats` (tout en une passe), `achievements()`, `nextUp`, `achievementProgress`, filtres, taux, tri des toasts |
| `pokemonGroups.js` | Listes de numéros du Pokédex des succès « possède-les tous » : lignées, starters, légendaires, fabuleux, Ultra-Chimères, badges d'arène, Conseil 4, Maîtres, rivaux (Kanto ; les lignées sont toutes dans les fichiers de région) |
| `kanto.js` | Données Gen 1 : lignées de Rouge/Bleu, solitaires, bébés, évolutions tardives, formes régionales (noms de cartes), routes et lieux (Pokémon sauvages, PokéAPI), villes et dresseurs (motifs sur les noms de cartes), premières séries |
| `johto.js`, `hoenn.js`, `sinnoh.js`, `unova.js`, `kalos.js`, `alola.js`, `galar.js`, `paldea.js` | Un fichier par région après Kanto, un objet de même forme (champs décrits en tête de hoenn.js) : lignées, solitaires, bébés, évolutions tardives, formes régionales, arènes, Conseil 4, rivaux, dresseurs en cartes, routes et lieux (PokéAPI), lieux en cartes, séries |
| `challenge.js` | Économie du Défi (**miroir** du SQL) : prix, recyclage (`recyclePreview` avec sélection et nombre d'exemplaires par carte, `duplicateGroups`), fabrication, récompense quotidienne, comptes à rebours UTC |
| `minigame.js` | Règles de « Plus ou moins » (**miroir** de `minigame_rules()`) |
| `electrodeFlip.js` | Règles d'« Électrode Shiny Flip » (**miroir** de `electrode_flip_rules()` / `electrode_flip_end()`) : points, niveau suivant, pièces, lignes sûres |
| `superEffective.js` | Règles de « Super efficace ! » (**miroir** de `super_effective_rules()` / `super_effective_types()` / `super_effective_option_count()`) : nombre de choix selon la série, pièces, touches 1 à 6 |
| `evolutionChain.js` | Règles de « Chaîne d'évolution » (**miroir** de `evolution_chain_rules()` / `evolution_chain_intruders()`) : intrus selon la série, pièces, `chainLength(run)` (2 ou 3 cartes, 3 avant 0019), `togglePick` (choisir / reprendre une carte) |
| `cardPrice.js` | `cardPriceEur(card)` : prix en € d'une carte pokemontcg.io (Cardmarket, sinon TCGplayer converti). Utilisé par `scripts/populate.mjs` |
| `trades.js` | Limites des échanges (**miroir** de `propose_trade`), `groupTrades`, `searchEntries`, `tradeNews` (ce qu'une ligne temps réel signifie pour le joueur) |
| `sets.js` | URL des logos, sous-sets (`isSubset`, `packSetId`, `subsetsOf`), `groupSetsByYear`, `starterSets` (Set de base, 151 et le set le plus récent, proposés au premier booster) |
| `feed.js` | `groupFeed(pulls)` : tirages consécutifs d'un même joueur dans le même mode en une entrée (le plus rare en avant), pour le fil de Communauté et « En direct » de l'accueil |
| `pokemonNamesFr.js` | Généré par `node scripts/region-tools.mjs fr-names` (ne pas éditer) : `frenchName(dex)`, nom français officiel de chaque Pokémon (PokéAPI). Les noms de cartes sont en anglais ; la recherche et la fiche d'une carte s'en servent |
| `pvp.js` | Règles des combats PvP (**miroir** de `pvp_rules()` / `pvp_prizes()` / `pvp_damage()` / `pvp_elo_change()`) : `prizesFor`, `damageAgainst(from, attack, to)`, `energyAfter`, `canPay`, `bestDamage`, `eloChange`, `record` (victoires, défaites, nuls et taux, attaques + défenses), `parseFormat` (`all`, `era:<série>`, `set:<id>`), `toggleDeckCard`, `hpPercent` ; decks (0026) : `DECK_ROLES`, `deckRoles` (lit aussi le deck unique d'avant 0026), `defendingDeck`, `autoDeck(cards, role)` (le « Deck auto », voir 05 parcours) ; bots (0027, **miroir** de `pvp_rules()`) : `BOT_LEVELS`, `BOT_COINS`, `BOT_PAID_PER_DAY`, `BOT_BATTLES_PER_DAY`, `botCoins(level, status, paid)` ; testeurs (0028, **miroir** de `pvp_open_to()`) : `PVP_TESTERS` (`null` = ouvert à tous), `pvpOpenTo(username)` |
| `games.js` | Registre des mini-jeux |
| `beta.js` | `BETA_END` (null tant que la bêta dure) + `isBetaTester(createdAt)` : inscrit avant la fin de la bêta |
| `cards.js`, `progress.js`, `time.js`, `tilt.js`, `appVersion.js`, `chunkError.js` | Petits utilitaires (regroupement, pourcentage, « il y a 3 min », inclinaison 3D, détection de build, erreur de chunk) |

---

## 7. Composants partagés

| Composant | Rôle |
| --- | --- |
| `AppHeader` | En-tête + barre d'onglets mobile + bande de mode ([§ 2](#len-tête-appheadervue)) |
| `BoosterArt` | Booster dessiné en CSS : logo du set, symbole, carte phare dans une fenêtre. Sans logo = booster générique « n'importe quel set ». Taille via `--booster-w` |
| `BoosterPack` | Le booster qu'on déchire. Deux copies découpées en zigzag ; `TEAR_MS = 1300`. Version `lite` : une seule copie qui se comprime et éclate en `TEAR_MS_LITE = 550` |
| `CardStack` | Pile face cachée : chaque tap retourne la carte suivante ; balayage sur tactile. Les cartes rares « se chargent » 0,55 s avant de se retourner avec un flash |
| `HoloCard` | Carte avec inclinaison 3D + reflet holographique qui suivent le pointeur |
| `CardDetail` | Fiche plein écran (flèches, balayage), historique de prix, liste de souhaits, fabrication/recyclage en Défi |
| `SetPicker` | Grille de sets cherchable, groupée par année (sous-sets masqués), avec la complétion de chaque set commencé (prop `owned`) |
| `PriceChart` | Courbe du prix d'une carte (un relevé par jour d'import) |
| `PokedexGrid`, `WishlistGrid`, `ShowcasePicker`, `RecycleDuplicates` | Onglets Pokédex et souhaits, choix de la vitrine, recyclage (tout, ou « Choisir… » par carte ou par rareté, − / + pour le nombre d'exemplaires) |
| `SetGoal` | « Série la plus avancée : Base, 1 / 102 (1 %) » + barre : un objectif à portée du débutant, sous la progression globale (hubs Illimité et Défi, collection ; prop `to` = lien vers le classeur) |
| `CopyStepper` | − n/max + : nombre d'exemplaires à recycler (liste « Choisir… » et fiche d'une carte) |
| `PvpCard` | Une carte de combat PvP (instantané `pvp_card()`) : image, PV (barre si `show-hp`), ses attaques (coût en énergie, dégâts imprimés), types, faiblesse et récompenses (« 2 récompenses » pour un ex…) ; `hidden` = dos de carte (carte adverse pas encore jouée) |
| `BetaBadge` | Pastille « Bêta-testeur » (bordure holo + reflet qui passe, coupé sans effets / mouvement réduit), `compact` = juste « β ». Profil et tuile profil du hub |
| `UsernameCombobox` | Champ pseudo avec suggestions des dresseurs publics (`searchUsernames`, 200 ms après la frappe, 8 au maximum, flèches + Entrée, Échap). Événement `pick` au choix d'une suggestion. Partenaire d'échange |
| `AchievementTile`, `AchievementToasts` | Tuile d'un succès, notifications « succès débloqué » (et, dans la même pile, les toasts d'échange du store `trades`) |
| `ModeSwitch`, `CoinAmount`, `ScrollTopButton`, `BrandLogo`, `ThemeToggle`, `LanguageSwitcher`, `HeroCardFan`, `AuthPanel`, `PointerFx` | Sélecteur Illimité/Défi, montant en pièces, retour en haut, logo, thème, langue, éventail de l'accueil, formulaire de connexion, étincelles au clic |

---

## 8. i18n, design system, sons

**i18n** ([src/i18n/](../../src/i18n/)) : aucun texte en dur dans les
templates. Chaque clé existe dans `en.json` **et** `fr.json`. La langue
vient de `localStorage.lang`, sinon de la langue du navigateur, sinon
l'anglais. Piège : `@` est spécial pour vue-i18n, il s'écrit `{'@'}`.

**Design system « Holo Collector »**
([global.css](../../src/assets/styles/global.css)) : sombre par défaut,
accents holographiques, actions principales en jaune. Polices Unbounded
(titres) et Manrope (texte). **Toutes les couleurs sont des tokens
`--pb-*`**, redéfinis sous `[data-bs-theme='light']` : aucun composant ne
code une couleur en dur. Briques réutilisables : `.pb-glass`,
`.pb-holo-text`, `.pb-eyebrow`, `.glow-button`, `.pb-skeleton`. Fond uni
(plus d'aurora ni de grille de points), pas de pastille au-dessus des
titres (`.pb-eyebrow` = simple ligne de contexte : paquet 2/5, nom de la
série), pas de dégradé sur les titres de page, pas de tirets cadratins
dans les textes : tout ça faisait « site généré par IA » (retour
utilisateur, 2026-09-28). Les effets
sont coupés sous `prefers-reduced-motion` ou avec *Profil > Réglages >
Effets visuels*.

**Animations légères** : sur écran tactile (mode `auto`), l'ouverture
utilise des variantes sans 3D, flou ni fusion, qui saccadaient sur
téléphone (`lite` sur `BoosterPack` et `CardStack`).

**Sons et vibrations** ([src/lib/sfx.js](../../src/lib/sfx.js)) : tout est
synthétisé avec la Web Audio API, sans fichier audio (`tear`, `flip`,
`rare`, `hit`, `achievement`, `buzz`). Chaque appel reçoit le réglage
`settings.sound` ou `settings.vibration`. `flip` (10 fois par paquet) est
volontairement discret : bruit filtré en bande qui descend, aigus coupés,
hauteur légèrement différente à chaque carte.

**Textes français** : espaces insécables avant `: ; ! ? »` et après `«`
dans `fr.json` (sinon le signe peut passer seul à la ligne) ;
`src/i18n/locales.test.js` le vérifie, et interdit les tirets cadratins.

**Image de partage** ([src/lib/shareCard.js](../../src/lib/shareCard.js)) :
dessine une image 1080×1350 de la carte dans un canvas, puis ouvre le
partage natif (ou télécharge l'image).

---

## 9. PWA, service worker et nouvelles versions

- **Installable** : [public/manifest.webmanifest](../../public/manifest.webmanifest)
  + [public/sw.js](../../public/sw.js), enregistré en production
  uniquement ([src/lib/pwa.js](../../src/lib/pwa.js)). Le bouton
  « Installer l'app » du profil réutilise l'événement
  `beforeinstallprompt`.
- **Ce que le service worker met en cache** : le squelette de l'app (réseau
  d'abord, cache hors ligne), les fichiers `/assets/*` (hashés, donc
  immuables), les polices, et les images de cartes chargées par de simples
  `<img>` (400 au maximum). **Jamais Supabase.** Il ne met pas en cache les
  images chargées en CORS (image de partage), sinon le canvas serait
  « contaminé ». Changer `sw.js` → incrémenter `VERSION`.
- **Onglets ouverts pendant un déploiement**
  ([src/lib/appVersion.js](../../src/lib/appVersion.js)) : quand l'app
  revient au premier plan (5 min minimum entre deux vérifications, et
  toutes les 30 min), elle relit `/` et compare le script d'entrée
  `/assets/index-<hash>.js`. S'il a changé, elle émet `pb:update-ready`, et
  la prochaine vraie navigation fait un rechargement complet. Le joueur
  n'est jamais interrompu au milieu d'une page.
- [vercel.json](../../vercel.json) renvoie tout vers `index.html` **sauf
  `/assets/*`** : un chunk disparu répond 404 (détecté), pas une page HTML.
  `sw.js` est servi sans cache.

---

## 10. Recettes : ajouter quelque chose

**Une page**
1. La vue dans `src/views/`, qui commence par `<div class="pb-page"><AppHeader />`.
2. La route dans `router/index.js` (`requiresAuth`, `mode` ou `sharedMode`).
3. Si elle n'a pas de lien dans la navigation : l'ajouter à `PARENTS` dans
   `AppHeader.vue` + un lien retour.
4. ≥ 992 px et 320 px : pas de défilement horizontal (grille à une colonne
   = `grid-template-columns: minmax(0, 1fr)`).
5. L'ajouter à `e2e/navigation.spec.js` (« no page scrolls sideways »,
   mode visible).
6. Textes dans `en.json` + `fr.json`.

**Un appel au serveur**
1. Une migration qui crée la table ou la RPC ([Outillage](06-outillage.md#5-écrire-une-migration)).
2. Une fonction dans le bon fichier `api/`.
3. Le faux point d'accès dans `e2e/support/supabase.js`.
4. Cette doc : [Base de données](03-base-de-donnees.md) + [Référence API](04-reference-api.md).

**Un succès** : une définition dans `utils/achievements.js` + son titre et
sa description EN/FR (`achievements.items.<id>.title`,
`achievements.desc.<famille>`), éventuellement `sub` (titre
`achievements.subs.<sub>`) et `tags` (régions). `achievements.test.js` échoue s'il manque
une traduction, ou si deux groupes demandent exactement les mêmes Pokémon. Il se débloque rétroactivement pour tous ceux qui
remplissent déjà la condition.

**Un mini-jeu** : une entrée dans `utils/games.js` (id, route, icône),
les textes `games.items.<id>`, la route `challenge-game-<id>`, son statut
dans `useGames()` (`statusOf` : son store, sa ligne « ce qu'il paie encore
aujourd'hui », son record), ses RPC côté serveur (les gains se décident en SQL,
comme pour « Plus ou moins »).
Un jeu annoncé mais pas encore codé : une entrée `soon: true` sans route
(plus les textes) ; il s'affiche « Bientôt disponible », non cliquable, sur
la page des jeux et la tuile du hub. Retirer `soon` et ajouter la route
quand il existe.
