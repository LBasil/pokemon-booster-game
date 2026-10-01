// Kalos (Gen 6) data behind the Kalos achievements of src/utils/achievements.js,
// read by regionFocus() there (fields: see hoenn.js). Teams checked on
// Poképédia (X/Y, first battle), card names in the database.
export default {
  region: 'kalos',
  games: { en: 'X and Y', fr: 'X et Y' },
  dex: [650, 721],
  dexTiers: [25, 50],

  // Every evolution line of X and Y that starts in Kalos (Sylveon is in
  // eeveelutions). Some ids predate this list.
  lines: {
    chespinLine: [650, 651, 652],
    fennekinLine: [653, 654, 655],
    froakieLine: [656, 657, 658],
    bunnelbyLine: [659, 660],
    fletchlingLine: [661, 662, 663],
    scatterbugLine: [664, 665, 666],
    litleoLine: [667, 668],
    flabebeLine: [669, 670, 671],
    skiddoLine: [672, 673],
    panchamLine: [674, 675],
    espurrLine: [677, 678],
    honedgeLine: [679, 680, 681],
    spritzeeLine: [682, 683],
    swirlixLine: [684, 685],
    inkayLine: [686, 687],
    binacleLine: [688, 689],
    skrelpLine: [690, 691],
    clauncherLine: [692, 693],
    helioptileLine: [694, 695],
    tyruntLine: [696, 697],
    amauraLine: [698, 699],
    goomyLine: [704, 705, 706],
    phantumpLine: [708, 709],
    pumpkabooLine: [710, 711],
    bergmiteLine: [712, 713],
    noibatLine: [714, 715],
  },
  lineTiers: [10],

  extras: {
    // Don't evolve (legendaries and mythicals aside)
    kalosSolos: [676, 701, 702, 703, 707],
    // Both fossils' lines
    kalosFossils: [696, 697, 698, 699],
  },

  // Gym leaders' teams (X/Y), by badge
  gyms: {
    bugBadge: [283, 666], // Viola
    cliffBadge: [698, 696], // Grant
    rumbleBadge: [619, 67, 701], // Korrina
    plantBadge: [189, 70, 673], // Ramos
    voltageBadge: [587, 82, 695], // Clemont
    fairyBadge: [303, 122, 700], // Valerie
    psychicBadge: [561, 199, 678], // Olympia
    icebergBadge: [460, 615, 713], // Wulfric
  },
  // The Elite Four (X/Y). Champion Diantha is in CHAMPIONS
  eliteFour: {
    malva: [668, 663, 324, 609],
    siebold: [693, 689, 130, 121],
    wikstrom: [707, 681, 476, 212],
    drasna: [691, 715, 334, 621],
  },
  // Lysandre in his lab's last battle, AZ after the League
  people: {
    lysandre: [620, 668, 430, 130],
    az: [324, 623, 561],
  },

  // No Viola, Ramos, Valerie or Wulfric card yet, nor Malva or Wikstrom
  trainerCards: {
    tc_kalosGymLeaders: { patterns: [/^Grant$/, /^Korrina\b/, /^Clemont\b/, /^Olympia$/] },
    tc_kalosEliteFour: { patterns: [/^Siebold$/, /^Drasna$/] },
    tc_diantha: { pattern: /^Diantha$/, target: 1 },
    tc_kalosFriends: { patterns: [/^Shauna$/, /^Tierno$/, /^Trevor$/, /^Serena$/] },
    tc_sycamore: { pattern: /^Professor Sycamore$/, target: 1 },
    tc_az: { pattern: /^AZ\b/, target: 1 },
    tc_teamFlare: { pattern: /^(Team Flare\b|Lysandre\b|Xerosic\b)|Team Flare (Hyper )?Gear$/, target: 10 },
  },

  // Wild Pokémon of X and Y (`region-tools.mjs encounters 6 x,y`: hordes,
  // ambushes, flowers and rough terrain left out, Basculin's two forms are
  // one). City waters, the Friend Safari, Sea Spirit's Den (the legendary
  // birds), the Team Flare HQ and Unknown Dungeon (one legend each) are
  // left out; Route 16 includes Couriway Town.
  routes: {
    kalosRoute2: [10, 13, 16, 263, 659, 661, 664],
    kalosRoute3: [16, 25, 119, 130, 183, 206, 284, 298, 342, 399, 412, 659, 661],
    kalosRoute5: [63, 84, 311, 312, 316, 659, 672, 674, 676],
    kalosRoute7: [143, 235, 313, 314, 315, 453, 580, 669, 682, 684],
    kalosRoute8: [72, 91, 121, 211, 320, 325, 335, 336, 359, 371, 425, 619, 686, 691, 693],
    kalosRoute10: [133, 209, 228, 309, 561, 587, 622, 701],
    kalosRoute11: [30, 33, 297, 397, 433, 434, 538, 539, 702],
    kalosRoute12: [72, 79, 102, 127, 128, 131, 214, 222, 224, 241, 367, 368, 417, 441, 458],
    kalosRoute14: [61, 70, 93, 195, 340, 451, 455, 588, 616, 618, 704],
    kalosRoute15: [61, 262, 271, 419, 451, 505, 510, 550, 590, 624, 707],
    kalosRoute16: [61, 271, 419, 550],
    kalosRoute18: [28, 75, 247, 305, 324, 533, 631, 632],
    kalosRoute19: [61, 186, 195, 340, 618, 705],
    kalosRoute20: [39, 164, 571, 575, 591, 709],
    kalosRoute21: [61, 148, 271, 419, 550],
    kalosRoute22: [54, 83, 119, 130, 184, 206, 298, 319, 399, 447, 659, 667],
  },
  landmarks: {
    santaluneForest: [10, 11, 13, 14, 25, 511, 513, 515, 661, 664],
    parfumPalace: [119, 130, 342],
    glitteringCave: [66, 95, 104, 111, 115, 303, 337, 338],
    connectingCave: [41, 293, 307, 610],
    reflectionCave: [122, 202, 302, 433, 524, 577, 703],
    azureBay: [72, 79, 102, 131, 171, 224, 441, 458, 594, 686],
    lostHotel: [82, 101, 607, 624, 707],
    frostCavern: [61, 93, 124, 221, 419, 550, 614, 615, 712],
    pokemonVillage: [61, 271, 550],
    terminusCave: [28, 75, 247, 305, 632, 718],
    kalosVictoryRoad: [61, 62, 75, 93, 108, 271, 419, 533, 550, 621, 634],
  },
  // Lumiose is the only city with a card: with the places
  placeCards: [/^Lumiose City$/, /^Prism Tower$/, /^Lysandre Labs$/],

  // XY's sets (Hoenn's ORAS ones, Generations and Evolutions aside), then
  // the Mega Evolution series (2025, Legends: Z-A in Lumiose City)
  sets: {
    xySets: ['xy1', 'xy2', 'xy3', 'xy4', 'xy7', 'xy8', 'xy9', 'xy10', 'xy11'],
    megaSets: ['me1', 'me2', 'me3', 'me4', 'me5'],
  },
}
