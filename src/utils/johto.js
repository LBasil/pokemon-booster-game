// Johto (Gen 2) data behind the Johto achievements of src/utils/achievements.js.
// Every region after Kanto has a file of this shape, read by regionFocus()
// there (fields: see hoenn.js). Pokémon groups are National Pokédex numbers;
// each id has its EN/FR title (achievements.items.<id>.title) and a
// description naming the members (achievements.desc.groups.<id>, official FR
// names): change a list, change both texts (`node scripts/region-tools.mjs
// texts johto` writes the missing line and place texts). Card patterns match
// the card names of the database (`region-tools.mjs cards <regex>`).
export default {
  region: 'johto',
  games: { en: 'Gold and Silver', fr: 'Or et Argent' },
  dex: [152, 251],
  dexTiers: [25, 50],

  // Every evolution line of Gold and Silver that starts in Johto (babies and
  // new evolutions of Kanto Pokémon are Kanto's: kantoBabies,
  // kantoNewEvolutions). Some ids predate this list.
  lines: {
    chikoritaLine: [152, 153, 154],
    cyndaquilLine: [155, 156, 157],
    totodileLine: [158, 159, 160],
    sentretLine: [161, 162],
    hoothootLine: [163, 164],
    ledybaLine: [165, 166],
    spinarakLine: [167, 168],
    chinchouLine: [170, 171],
    togepiLine: [175, 176],
    natuLine: [177, 178],
    mareepLine: [179, 180, 181],
    marillLine: [183, 184],
    hoppipLine: [187, 188, 189],
    sunkernLine: [191, 192],
    wooperLine: [194, 195],
    pinecoLine: [204, 205],
    snubbullLine: [209, 210],
    teddiursaLine: [216, 217],
    slugmaLine: [218, 219],
    swinubLine: [220, 221],
    remoraidLine: [223, 224],
    houndourLine: [228, 229],
    phanpyLine: [231, 232],
    larvitarLine: [246, 247, 248],
  },
  lineTiers: [10],

  extras: {
    // Don't evolve in Gold and Silver (legendaries aside). Hitmontop too: the
    // only one of Tyrogue's evolutions new in Johto
    johtoSolos: [185, 190, 193, 198, 200, 201, 202, 203, 206, 207, 211, 213, 214, 215, 222, 225, 226, 227, 234, 235, 237, 241],
    // Babies added to Johto Pokémon later (Azurill, Wynaut, Bonsly, Mantyke)
    johtoBabies: [298, 360, 438, 458],
    // Evolutions later generations gave Johto Pokémon (regional forms' included)
    johtoNewEvolutions: [424, 429, 430, 461, 468, 469, 472, 473, 864, 899, 901, 903, 904, 980, 981, 982],
  },
  // Regional forms of Johto Pokémon, by card name
  forms: {
    johtoForms: {
      names: ['Galarian Corsola', 'Hisuian Qwilfish', 'Hisuian Sneasel', 'Hisuian Typhlosion', 'Paldean Wooper'],
      tags: ['johto', 'galar', 'sinnoh', 'paldea'],
    },
  },

  // Gym leaders' teams (Gold/Silver), by badge
  gyms: {
    zephyrBadge: [16, 17], // Falkner
    hiveBadge: [11, 14, 123], // Bugsy
    plainBadge: [35, 241], // Whitney
    fogBadge: [92, 93, 94], // Morty
    stormBadge: [57, 62], // Chuck
    mineralBadge: [81, 208], // Jasmine
    glacierBadge: [86, 87, 221], // Pryce
    risingBadge: [148, 230], // Clair
  },
  // The Elite Four (Gold/Silver). Champion Lance is lanceJohto in CHAMPIONS
  eliteFour: {
    will: [178, 124, 103, 80],
    johtoKoga: [168, 49, 205, 89, 169],
    johtoBruno: [237, 106, 107, 95, 68],
    karen: [197, 45, 94, 198, 229],
  },

  // Cards bearing a Johto trainer's name: { patterns } = one card of each,
  // { pattern, target } = that many cards. Only 4 gym leaders have one (no
  // Bugsy, Chuck, Pryce or Clair card yet); Lance's cards count for Kanto's
  // Elite Four.
  trainerCards: {
    tc_johtoGymLeaders: { patterns: [/^Falkner\b/, /^Whitney\b/, /^Morty\b/, /^Jasmine\b/] },
    tc_johtoEliteFour: { patterns: [/^Will('s\b|$)/, /^Koga\b/, /^Bruno\b/, /^Karen\b/] },
    tc_ethan: { pattern: /^Ethan's\b/, target: 5 },
    tc_elm: { pattern: /^Professor Elm\b/, target: 3 },
    // Team Rocket's executives, back in Johto three years later
    tc_rocketExecutives: { patterns: [/\bArcher\b/, /\bAriana\b/, /\bPetrel\b/, /\bProton\b/] },
  },

  // Wild Pokémon of Gold and Silver (`region-tools.mjs encounters 2
  // gold,silver`: on land, surfing, Super Rod and one-off encounters like
  // Sudowoodo). Routes 26 to 28 are Kanto's.
  routes: {
    route29: [16, 19, 161, 163],
    route30: [10, 11, 13, 14, 16, 19, 60, 61, 129, 163, 165, 167],
    route31: [10, 11, 13, 14, 16, 19, 60, 61, 69, 129, 163, 165, 167],
    route32: [19, 23, 41, 69, 72, 73, 129, 179, 187, 194, 195, 211],
    route33: [19, 21, 23, 41, 187],
    route34: [19, 63, 72, 73, 96, 98, 99, 120, 132, 222],
    route35: [16, 29, 32, 54, 55, 60, 63, 96, 129, 132, 163, 193],
    route36: [16, 29, 32, 37, 58, 163, 185, 234],
    route37: [16, 17, 37, 58, 163, 165, 167, 234],
    route38: [19, 20, 52, 81, 83, 128, 209, 241],
    route39: [19, 20, 52, 81, 83, 128, 241],
    route40: [72, 73, 98, 99, 120, 222],
    route41: [72, 73, 90, 170, 171, 226],
    route42: [21, 41, 56, 118, 119, 129, 179, 180],
    route43: [17, 48, 60, 129, 164, 179, 180, 203],
    route44: [60, 61, 69, 70, 108, 114, 129, 223],
    route45: [74, 75, 129, 147, 148, 207, 216, 227, 231],
    route46: [19, 21, 39, 74],
  },
  // Caves, forests, towers and buildings (same rules, every floor together),
  // with their legends (Lugia, Ho-Oh, the red Gyarados, Rocket HQ's traps).
  // The National Park keeps its Bug-Catching Contest Pokémon (it predates
  // this list); Mt. Silver is in KANTO_LANDMARKS.
  landmarks: {
    sproutTower: [19, 92],
    ruinsOfAlph: [60, 129, 177, 194, 195, 201, 235],
    unionCave: [19, 20, 27, 41, 42, 72, 73, 74, 95, 98, 99, 118, 119, 120, 129, 131, 194, 195, 222],
    slowpokeWell: [41, 42, 79, 80, 118, 119, 129],
    ilexForest: [10, 11, 13, 14, 41, 43, 46, 54, 55, 60, 129],
    nationalPark: [123, 127, 12, 15, 48, 46],
    burnedTower: [19, 20, 41, 109, 126],
    tinTower: [19, 92, 250],
    whirlIslands: [41, 42, 72, 73, 86, 98, 99, 116, 117, 249],
    mtMortar: [19, 20, 41, 42, 66, 67, 74, 75, 118, 119, 129, 183],
    lakeOfRage: [129, 130],
    teamRocketHq: [74, 100, 101, 109],
    icePath: [41, 42, 124, 220, 225],
    dragonsDen: [129, 147, 148],
    darkCave: [41, 42, 74, 75, 118, 119, 129, 202, 206],
    tohjoFalls: [19, 20, 41, 42, 79, 118, 119, 129],
  },
  // Places printed as Stadium cards (johtoPlaceCards). No Johto city has a
  // card of its own (else: cities, { id: pattern }, like KANTO_CITIES)
  placeCards: [/^Sprout Tower$/, /^Ruins of Alph$/, /^Burned Tower$/, /^Radio Tower$/],

  // The sets set in the region: Neo, then the HeartGold & SoulSilver series
  sets: {
    neoSets: ['neo1', 'neo2', 'neo3', 'neo4'],
    hgssSets: ['hgss1', 'hgss2', 'hgss3', 'hgss4', 'col1'],
  },
}
