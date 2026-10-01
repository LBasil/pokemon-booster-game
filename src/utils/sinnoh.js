// Sinnoh (Gen 4) data behind the Sinnoh achievements of src/utils/achievements.js,
// read by regionFocus() there (fields: see hoenn.js). Teams checked on
// Poképédia (Diamond/Pearl, first battle), card names in the database.
export default {
  region: 'sinnoh',
  games: { en: 'Diamond and Pearl', fr: 'Diamant et Perle' },
  dex: [387, 493],
  dexTiers: [25, 50, 100],

  // Every evolution line of Diamond and Pearl that starts in Sinnoh (the
  // babies and evolutions it gave older Pokémon are their region's). Some
  // ids predate this list.
  lines: {
    turtwigLine: [387, 388, 389],
    chimcharLine: [390, 391, 392],
    piplupLine: [393, 394, 395],
    starlyLine: [396, 397, 398],
    bidoofLine: [399, 400],
    kricketotLine: [401, 402],
    shinxLine: [403, 404, 405],
    cranidosLine: [408, 409],
    shieldonLine: [410, 411],
    burmyLine: [412, 413, 414],
    combeeLine: [415, 416],
    buizelLine: [418, 419],
    cherubiLine: [420, 421],
    shellosLine: [422, 423],
    drifloonLine: [425, 426],
    bunearyLine: [427, 428],
    glameowLine: [431, 432],
    stunkyLine: [434, 435],
    bronzorLine: [436, 437],
    gibleLine: [443, 444, 445],
    rioluLine: [447, 448],
    hippopotasLine: [449, 450],
    skorupiLine: [451, 452],
    croagunkLine: [453, 454],
    finneonLine: [456, 457],
    snoverLine: [459, 460],
  },
  lineTiers: [10],

  extras: {
    // Don't evolve (legendaries and mythicals aside)
    sinnohSolos: [417, 441, 442, 455, 479],
    // Both fossils' lines
    sinnohFossils: [408, 409, 410, 411],
    // The babies Diamond and Pearl added to older lines
    sinnohBabies: [406, 433, 438, 439, 440, 446, 458],
    // The evolutions Diamond and Pearl gave older Pokémon
    sinnohEvolutionBoom: [407, 424, 429, 430, 461, 462, 463, 464, 465, 466, 467, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477, 478],
    // The new Pokémon of Legends: Arceus (Hisui, Sinnoh long ago)
    hisuiNewPokemon: [899, 900, 901, 902, 903, 904, 905],
  },
  // Hisuian forms, by card name (Basculin's is printed "Hisuian Basculin")
  forms: {
    hisuianForms: {
      names: ['Growlithe', 'Arcanine', 'Voltorb', 'Electrode', 'Typhlosion', 'Qwilfish', 'Sneasel', 'Samurott', 'Lilligant', 'Basculin', 'Zorua', 'Zoroark', 'Braviary', 'Sliggoo', 'Goodra', 'Avalugg', 'Decidueye'].map((name) => `Hisuian ${name}`),
      tags: ['sinnoh'],
    },
  },

  // Gym leaders' teams (Diamond/Pearl), by badge
  gyms: {
    coalBadge: [74, 95, 408], // Roark
    forestBadge: [420, 387, 407], // Gardenia
    cobbleBadge: [307, 67, 448], // Maylene
    fenBadge: [130, 195, 419], // Crasher Wake
    relicBadge: [426, 94, 429], // Fantina
    mineBadge: [436, 208, 411], // Byron
    icicleBadge: [459, 215, 308, 460], // Candice
    beaconBadge: [26, 224, 424, 405], // Volkner
  },
  // The Elite Four (Diamond/Pearl). Champion Cynthia is in CHAMPIONS
  eliteFour: {
    aaron: [269, 416, 267, 452, 214],
    bertha: [195, 76, 185, 450, 340],
    flint: [78, 428, 208, 392, 426],
    lucian: [122, 65, 203, 437, 308],
  },
  // Cyrus at Spear Pillar (Barry's team depends on your starter)
  people: {
    cyrus: [430, 130, 169, 461],
  },

  // No Maylene or Byron card yet
  trainerCards: {
    tc_sinnohGymLeaders: { patterns: [/^Roark\b/, /^Gardenia\b/, /^Crasher Wake\b/, /^Fantina\b/, /^Candice\b/, /^Volkner\b/] },
    tc_sinnohEliteFour: { patterns: [/^Aaron\b/, /^Bertha\b/, /^Flint\b/, /^Lucian\b/] },
    tc_cynthia: { pattern: /^Cynthia\b/, target: 10 },
    tc_sinnohHeroes: { patterns: [/^Barry$/, /^Dawn$/] },
    tc_rowan: { pattern: /^Professor Rowan\b/, target: 1 },
    tc_teamGalactic: { pattern: /^(Team Galactic\b|Cyrus\b|Galactic HQ$|Mars$|Charon\b)/, target: 10 },
  },

  // Wild Pokémon of Diamond and Pearl (`region-tools.mjs encounters 4
  // diamond,pearl`: Honey Trees left out). City waters and single-Pokémon
  // spots (Solaceon Ruins, Flower Paradise, Newmoon Island, Hall of Origin)
  // are left out.
  routes: {
    route201: [29, 32, 58, 84, 396, 399],
    route202: [58, 161, 263, 396, 399, 401, 403],
    route203: [41, 54, 55, 63, 104, 119, 130, 204, 270, 273, 280, 281, 396, 399, 401, 403],
    route204: [10, 13, 41, 54, 55, 119, 130, 191, 204, 270, 273, 280, 281, 396, 399, 401, 403, 406],
    route205: [54, 55, 72, 73, 79, 90, 130, 187, 188, 239, 270, 278, 279, 340, 399, 417, 418, 422, 457],
    route206: [41, 74, 77, 207, 299, 343, 401, 402, 434, 436],
    route207: [41, 66, 74, 207, 231, 234, 246, 401],
    route208: [41, 54, 55, 66, 130, 206, 236, 307, 335, 336, 340, 399, 400],
    route209: [37, 41, 54, 55, 92, 113, 119, 128, 130, 209, 241, 396, 397, 400, 438, 439, 442],
    route210: [54, 55, 66, 67, 74, 77, 113, 128, 130, 163, 164, 204, 241, 273, 274, 307, 335, 336, 340, 352, 371, 400, 402, 438, 439],
    route211: [41, 67, 74, 75, 77, 163, 164, 216, 236, 307, 333, 399, 433],
    route212: [23, 54, 55, 88, 119, 130, 194, 195, 235, 270, 271, 315, 340, 396, 397, 400, 402, 406],
    route213: [72, 73, 130, 224, 277, 278, 279, 319, 359, 418, 419, 422],
    route214: [37, 54, 55, 74, 75, 77, 119, 130, 185, 203, 207, 229, 262, 325, 402, 434],
    route215: [63, 64, 74, 77, 96, 207, 229, 262, 402],
    route216: [41, 67, 75, 164, 215, 217, 225, 307, 361, 459],
    route217: [41, 67, 164, 215, 217, 220, 307, 308, 361, 459],
    route218: [72, 73, 100, 122, 130, 132, 278, 279, 419, 422, 423, 431, 457],
    route219: [72, 73, 130, 278, 279, 366, 457],
    route220: [72, 73, 130, 170, 171, 278, 279, 457],
    route221: [30, 33, 72, 73, 83, 130, 185, 278, 279, 315, 366, 419, 422, 423, 434, 435, 457],
    route222: [72, 73, 122, 130, 180, 224, 278, 279, 300, 319, 419, 423, 431, 432, 441],
    route223: [73, 130, 224, 279, 320, 321, 458],
    route224: [44, 70, 73, 130, 177, 213, 224, 267, 279, 315, 355, 356, 370, 418, 419, 422, 423, 441],
    route225: [19, 20, 21, 22, 55, 56, 57, 61, 67, 130, 296, 315, 354, 435],
    route226: [19, 20, 21, 22, 55, 56, 57, 67, 73, 86, 87, 98, 117, 130, 279, 354, 363, 364, 369],
    route227: [22, 42, 60, 61, 75, 110, 111, 112, 130, 207, 227, 240, 322, 323, 324, 327, 340, 354],
    route228: [28, 50, 51, 60, 61, 112, 130, 328, 329, 331, 332, 340, 374, 450],
    route229: [16, 43, 44, 48, 49, 69, 70, 123, 127, 130, 166, 168, 204, 271, 274, 278, 279, 313, 314, 315, 432],
    route230: [43, 44, 55, 69, 70, 73, 86, 87, 130, 175, 222, 224, 267, 269, 279, 320, 321, 363, 364, 419, 423],
  },
  landmarks: {
    oreburghMine: [41, 74, 95],
    ravagedPath: [41, 42, 54, 55, 74, 130, 340],
    valleyWindworks: [72, 73, 90, 130, 179, 239, 278, 279, 309, 399, 417, 418, 422, 425, 457],
    eternaForest: [11, 14, 198, 200, 204, 265, 266, 267, 268, 269, 273, 287, 290, 406, 427],
    oldChateau: [92, 93, 94, 479],
    fuegoIronworks: [72, 73, 81, 90, 130, 187, 188, 278, 279, 304, 403, 404, 417, 419, 422, 423, 457],
    waywardCave: [27, 41, 74, 436, 443],
    mtCoronet: [35, 41, 42, 66, 67, 74, 75, 130, 147, 148, 164, 173, 294, 307, 308, 337, 338, 340, 349, 358, 433, 436, 437, 459, 460],
    lostTower: [41, 42, 92, 198, 200],
    ruinManiacCave: [74, 449],
    trophyGarden: [25, 35, 39, 52, 113, 133, 137, 172, 173, 174, 183, 298, 311, 312, 315, 351, 397, 402, 438, 439, 440],
    greatMarsh: [24, 46, 54, 55, 102, 115, 130, 163, 164, 183, 193, 194, 195, 285, 298, 315, 316, 318, 340, 396, 397, 399, 400, 406, 451, 452, 453, 454, 455],
    ironIsland: [41, 42, 72, 73, 74, 75, 95, 130, 208, 211, 278, 279, 302, 303, 457],
    lakeVerity: [54, 55, 119, 130, 202, 283, 337, 338, 396, 397, 399, 400],
    lakeValor: [54, 55, 108, 119, 130, 164, 202, 337, 338, 397, 400, 433, 482],
    lakeAcuity: [54, 55, 119, 130, 164, 202, 215, 217, 238, 337, 338, 400, 433, 480],
    valorLakefront: [30, 33, 74, 75, 203, 397, 400, 402],
    acuityLakefront: [41, 67, 164, 215, 216, 307, 308, 361, 459],
    spearPillar: [483, 484],
    sinnohVictoryRoad: [42, 64, 67, 75, 95, 130, 131, 208, 308, 419],
    starkMountain: [22, 42, 67, 74, 75, 95, 110, 111, 112, 207, 218, 219, 227, 240, 322, 323, 324, 354, 485],
    snowpointTemple: [42, 75, 95, 208, 215, 486],
    turnbackCave: [42, 93, 337, 338, 436, 437],
    sendoffSpring: [55, 119, 130, 164, 337, 338, 358, 397, 400],
  },
  // Sunyshore is the only city with a card (its Gym): with the places
  placeCards: [/^Mt\. Coronet$/, /^Snowpoint Temple$/, /^Stark Mountain$/, /^Lake Acuity$/, /^Galactic HQ$/, /^Sunyshore City Gym$/],

  // Diamond & Pearl's 7 sets, Platinum's 4, then the 2022 return
  // (Brilliant Stars, Astral Radiance, Lost Origin)
  sets: {
    dpSets: ['dp1', 'dp2', 'dp3', 'dp4', 'dp5', 'dp6', 'dp7'],
    platinumSets: ['pl1', 'pl2', 'pl3', 'pl4'],
    sinnohReturnSets: ['swsh9', 'swsh10', 'swsh11'],
  },
}
