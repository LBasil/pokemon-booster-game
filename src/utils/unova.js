// Unova (Gen 5) data behind the Unova achievements of src/utils/achievements.js,
// read by regionFocus() there (fields: see hoenn.js). Teams checked on
// Poképédia (Black/White, first battle), card names in the database.
export default {
  region: 'unova',
  games: { en: 'Black and White', fr: 'Noir et Blanc' },
  dex: [494, 649],
  dexTiers: [25, 50, 100],

  // Every evolution line of Black and White (all of its Pokémon are new).
  // Some ids predate this list.
  lines: {
    snivyLine: [495, 496, 497],
    tepigLine: [498, 499, 500],
    oshawottLine: [501, 502, 503],
    patratLine: [504, 505],
    lillipupLine: [506, 507, 508],
    purrloinLine: [509, 510],
    pansageLine: [511, 512],
    pansearLine: [513, 514],
    panpourLine: [515, 516],
    munnaLine: [517, 518],
    pidoveLine: [519, 520, 521],
    blitzleLine: [522, 523],
    roggenrolaLine: [524, 525, 526],
    woobatLine: [527, 528],
    drilburLine: [529, 530],
    timburrLine: [532, 533, 534],
    tympoleLine: [535, 536, 537],
    sewaddleLine: [540, 541, 542],
    venipedeLine: [543, 544, 545],
    cottoneeLine: [546, 547],
    petililLine: [548, 549],
    sandileLine: [551, 552, 553],
    darumakaLine: [554, 555],
    dwebbleLine: [557, 558],
    scraggyLine: [559, 560],
    yamaskLine: [562, 563],
    tirtougaLine: [564, 565],
    archenLine: [566, 567],
    trubbishLine: [568, 569],
    zoruaLine: [570, 571],
    minccinoLine: [572, 573],
    gothitaLine: [574, 575, 576],
    solosisLine: [577, 578, 579],
    ducklettLine: [580, 581],
    vanilliteLine: [582, 583, 584],
    deerlingLine: [585, 586],
    karrablastLine: [588, 589],
    foongusLine: [590, 591],
    frillishLine: [592, 593],
    joltikLine: [595, 596],
    ferroseedLine: [597, 598],
    klinkLine: [599, 600, 601],
    tynamoLine: [602, 603, 604],
    elgyemLine: [605, 606],
    litwickLine: [607, 608, 609],
    axewLine: [610, 611, 612],
    cubchooLine: [613, 614],
    shelmetLine: [616, 617],
    mienfooLine: [619, 620],
    golettLine: [622, 623],
    pawniardLine: [624, 625],
    ruffletLine: [627, 628],
    vullabyLine: [629, 630],
    deinoLine: [633, 634, 635],
    larvestaLine: [636, 637],
  },
  lineTiers: [10, 25],

  extras: {
    // Don't evolve in Black and White (legendaries and mythicals aside)
    unovaSolos: [531, 538, 539, 550, 556, 561, 587, 594, 615, 618, 621, 626, 631, 632],
    // Both fossils' lines
    unovaFossils: [564, 565, 566, 567],
    // Striaton's three monkeys and their evolutions
    elementalMonkeys: [511, 512, 513, 514, 515, 516],
    // Evolve when traded for each other
    tradeSwap: [588, 589, 616, 617],
    // Evolutions later generations gave Unova Pokémon
    unovaNewEvolutions: [867, 902, 983],
  },
  // Galarian forms of Unova Pokémon, by card name (Hisui's are in sinnoh.js)
  forms: {
    unovaForms: { names: ['Galarian Darumaka', 'Galarian Darmanitan', 'Galarian Yamask', 'Galarian Stunfisk'], tags: ['unova', 'galar'] },
  },

  // Gym leaders' teams (Black/White), by badge. Cilan, Chili or Cress
  // (depends on your starter) all have Lillipup + their monkey; Drayden
  // (Black) and Iris (White) have the same team.
  gyms: {
    trioBadge: [506, 511, 513, 515],
    basicBadge: [507, 505], // Lenora
    insectBadge: [544, 557, 542], // Burgh
    boltBadge: [587, 523], // Elesa
    quakeBadge: [552, 536, 530], // Clay
    jetBadge: [528, 521, 581], // Skyla
    freezeBadge: [583, 615, 614], // Brycen
    legendBadge: [611, 621, 612], // Drayden / Iris
  },
  // The Elite Four (Black/White). Champion Alder is in CHAMPIONS
  eliteFour: {
    shauntal: [563, 609, 593, 623],
    grimsley: [560, 625, 553, 510],
    caitlin: [561, 518, 579, 576],
    marshal: [538, 539, 534, 620],
  },
  // N in his castle (his legend aside: Zekrom or Reshiram by version) and
  // Ghetsis right after
  people: {
    n: [567, 565, 571, 584, 601],
    ghetsis: [563, 626, 537, 625, 604, 635],
  },

  // No Lenora, Burgh, Brycen, Drayden or Marlon card yet, nor Marshal
  trainerCards: {
    tc_unovaGymLeaders: { patterns: [/^(Cilan|Chili)\b/, /^Cheren\b/, /^Roxie\b/, /^Elesa\b/, /^Clay$/, /^Skyla$/, /^Iris\b/] },
    tc_unovaEliteFour: { patterns: [/^Shauntal$/, /^Grimsley\b/, /^Caitlin$/] },
    tc_n: { pattern: /^N('s\b|$)/, target: 10 },
    tc_unovaHeroes: { patterns: [/^Bianca\b/, /^Hilda$/, /^Hugh$/, /^Rosa\b/] },
    tc_juniper: { pattern: /^Professor Juniper$/, target: 1 },
    tc_teamPlasma: { pattern: /^(Team Plasma\b|Plasma (Frigate|Energy)$|Ghetsis$|Colress\b)/, target: 10 },
  },

  // Wild Pokémon of Black and White (`region-tools.mjs encounters 5
  // black,white`: shaking grass, dust clouds and rippling water left out,
  // Basculin's two forms are one). City waters, single-Pokémon spots
  // (Liberty Garden, N's Castle) and Victory Road's inner chambers are
  // left out; Route 8 includes the Moor of Icirrus.
  routes: {
    unovaRoute1: [349, 504, 506, 550],
    unovaRoute2: [504, 506, 509],
    unovaRoute3: [118, 504, 506, 509, 519, 522, 550],
    unovaRoute4: [98, 366, 370, 551, 554, 559, 592],
    unovaRoute5and16: [510, 568, 572, 574, 577],
    unovaRoute6: [60, 61, 520, 541, 550, 582, 585, 588, 590],
    unovaRoute7: [505, 520, 523, 585, 590, 613],
    unovaRoute8: [339, 536, 616, 618],
    unovaRoute9: [510, 569, 572, 575, 578, 624],
    unovaRoute10: [507, 538, 539, 590, 591, 626, 627, 629],
    unovaRoute11: [55, 118, 207, 335, 336, 418, 550, 588, 591, 624, 627, 629],
    unovaRoute12: [11, 14, 78, 127, 191, 206, 214, 415, 421, 520],
    unovaRoute13: [42, 90, 98, 114, 120, 277, 278, 279, 337, 338, 359, 370, 426],
    unovaRoute14: [39, 55, 118, 213, 334, 357, 418, 426, 550, 606, 619],
    unovaRoute15: [22, 105, 115, 207, 247, 538, 539],
    unovaRoute17: [116, 456, 592],
    unovaRoute18: [116, 170, 456, 505, 538, 539, 557, 559, 592],
  },
  landmarks: {
    dreamyard: [504, 509, 517, 518],
    pinwheelForest: [118, 519, 532, 535, 538, 539, 540, 543, 546, 548, 550, 640],
    desertResort: [551, 554, 556, 557, 559, 561],
    relicCastle: [28, 95, 344, 551, 552, 562, 563, 637],
    coldStorage: [507, 532, 572, 582],
    chargestoneCave: [525, 595, 597, 599, 602],
    celestialTower: [605, 607],
    twistMountain: [525, 527, 533, 613, 615],
    dragonspiralTower: [147, 148, 520, 550, 582, 585, 613, 619, 621, 622, 643, 644],
    unovaVictoryRoad: [60, 61, 525, 527, 550, 611, 619, 627, 629, 631, 632, 633, 639],
    wellspringCave: [60, 61, 524, 527, 550],
    mistraltonCave: [525, 527, 610, 638],
    challengersCave: [60, 61, 75, 108, 302, 303, 447, 525, 527, 550],
    giantChasm: [35, 42, 60, 61, 86, 114, 124, 132, 215, 221, 225, 277, 337, 338, 359, 375, 426, 525, 550, 646],
    p2Laboratory: [116, 456, 505, 507, 559, 592, 599],
    villageBridge: [55, 318, 335, 336, 400, 550, 627, 629],
    abundantShrine: [37, 79, 118, 164, 198, 200, 234, 358, 437, 546, 548, 550, 645],
    undellaBay: [90, 223, 278, 279, 363, 370, 458],
    lostlornForest: [118, 520, 541, 543, 546, 548, 550, 571],
  },
  // No city has a card of its own, only two Gyms: with the places
  placeCards: [/^Skyarrow Bridge$/, /^Twist Mountain$/, /^Plasma Frigate$/, /^N's Castle$/, /^Aspertia City Gym$/, /^Virbank City Gym$/],

  // Black & White's sets (Team Plasma's aside), Team Plasma's 3, then the
  // 2025 return (Black Bolt, White Flare)
  sets: {
    bwSets: ['bw1', 'bw2', 'bw3', 'bw4', 'bw5', 'bw6', 'bw7', 'bw11'],
    plasmaSets: ['bw8', 'bw9', 'bw10'],
    unovaReturnSets: ['zsv10pt5', 'rsv10pt5'],
  },
}
