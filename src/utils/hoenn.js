// Hoenn (Gen 3) data behind the Hoenn achievements of src/utils/achievements.js,
// read by regionFocus() there. Same rules as johto.js: dex lists named in
// their EN/FR descriptions (official FR names), card patterns on the card
// names of the database. Fields:
//   region, games ({ en, fr }: the region's first games, for the texts),
//   dex ([from, to]) + dexTiers, lines + lineTiers (the last tier = all
//   lines is added), extras (more "own them all" groups), forms (by card
//   name, with their tags), gyms (one team per badge), eliteFour, people
//   (rivals and villains, "Rivals and heroes"), trainerCards, routes,
//   landmarks, cities? ({ id: pattern }), placeCards, sets ({ id: set ids }).
export default {
  region: 'hoenn',
  games: { en: 'Ruby and Sapphire', fr: 'Rubis et Saphir' },
  dex: [252, 386],
  dexTiers: [25, 50, 100],

  // Every evolution line of Ruby and Sapphire that starts in Hoenn (Azurill
  // and Wynaut are Johto's babies). Some ids predate this list.
  lines: {
    treeckoLine: [252, 253, 254],
    torchicLine: [255, 256, 257],
    mudkipLine: [258, 259, 260],
    poochyenaLine: [261, 262],
    zigzagoonLine: [263, 264],
    wurmpleLine: [265, 266, 267, 268, 269],
    lotadLine: [270, 271, 272],
    seedotLine: [273, 274, 275],
    taillowLine: [276, 277],
    wingullLine: [278, 279],
    raltsLine: [280, 281, 282],
    surskitLine: [283, 284],
    shroomishLine: [285, 286],
    slakothLine: [287, 288, 289],
    nincadaLine: [290, 291, 292],
    whismurLine: [293, 294, 295],
    makuhitaLine: [296, 297],
    skittyLine: [300, 301],
    aronLine: [304, 305, 306],
    medititeLine: [307, 308],
    electrikeLine: [309, 310],
    gulpinLine: [316, 317],
    carvanhaLine: [318, 319],
    wailmerLine: [320, 321],
    numelLine: [322, 323],
    spoinkLine: [325, 326],
    trapinchLine: [328, 329, 330],
    cacneaLine: [331, 332],
    swabluLine: [333, 334],
    barboachLine: [339, 340],
    corphishLine: [341, 342],
    baltoyLine: [343, 344],
    lileepLine: [345, 346],
    anorithLine: [347, 348],
    feebasLine: [349, 350],
    shuppetLine: [353, 354],
    duskullLine: [355, 356],
    snoruntLine: [361, 362],
    sphealLine: [363, 364, 365],
    clamperlLine: [366, 367, 368],
    bagonLine: [371, 372, 373],
    beldumLine: [374, 375, 376],
  },
  lineTiers: [10, 25],

  extras: {
    // Don't evolve in Ruby and Sapphire (legendaries aside)
    hoennSolos: [299, 302, 303, 311, 312, 313, 314, 315, 324, 327, 335, 336, 337, 338, 351, 352, 357, 358, 359, 369, 370],
    // Babies added to Hoenn Pokémon later (Budew, Chingling)
    hoennBabies: [406, 433],
    // Evolutions later generations gave Hoenn Pokémon
    hoennNewEvolutions: [407, 475, 476, 477, 478, 862],
  },
  forms: {
    hoennForms: { names: ['Galarian Zigzagoon', 'Galarian Linoone'], tags: ['hoenn', 'galar'] },
  },

  // Gym leaders' teams (Ruby/Sapphire), by badge
  gyms: {
    stoneBadge: [74, 299], // Roxanne
    knuckleBadge: [66, 296], // Brawly
    dynamoBadge: [81, 100, 82], // Wattson
    heatBadge: [218, 324], // Flannery
    balanceBadge: [289, 288], // Norman
    featherBadge: [277, 279, 227, 334], // Winona
    mindBadge: [337, 338], // Tate & Liza
    rainBadge: [370, 340, 364, 119, 350], // Wallace
  },
  // The Elite Four (Ruby/Sapphire). Champions Steven and Wallace are in CHAMPIONS
  eliteFour: {
    sidney: [262, 275, 332, 342, 359],
    phoebe: [356, 354, 302],
    glacia: [364, 362, 365],
    drake: [372, 334, 230, 330, 373],
  },
  // Wally at Victory Road, Maxie (Ruby) and Archie (Sapphire)
  people: {
    wally: [334, 301, 315, 82, 282],
    maxie: [262, 169, 323],
    archie: [262, 169, 319],
  },

  // No Wattson or Juan card yet
  trainerCards: {
    tc_hoennGymLeaders: { patterns: [/^Roxanne\b/, /^Brawly\b/, /^Flannery\b/, /^Norman\b/, /^Winona\b/, /^Tate & Liza\b/, /^Wallace\b/] },
    tc_hoennEliteFour: { patterns: [/^Sidney\b/, /^Phoebe\b/, /^Glacia\b/, /^Drake\b/] },
    tc_steven: { pattern: /^Steven\b/, target: 5 },
    tc_wally: { pattern: /^Wally\b/, target: 3 },
    tc_birch: { pattern: /^Professor Birch\b/, target: 2 },
    tc_teamMagma: { pattern: /^(Team Magma|Maxie)\b/, target: 15 },
    tc_teamAqua: { pattern: /^(Team Aqua|Archie)\b/, target: 15 },
  },

  // Wild Pokémon of Ruby and Sapphire (`region-tools.mjs encounters 3
  // ruby,sapphire`, with Feebas' tiles and the Devon Scope's Kecleon). Routes
  // with the same Pokémon share one achievement; city waters, single-Pokémon
  // spots (Rusturf Tunnel, Mirage Island), the legends' chambers (= the
  // legends' groups) and the Abandoned Ship (= the Tentacool line) are left out.
  routes: {
    route101: [261, 263, 265],
    route102: [183, 261, 263, 265, 270, 273, 280, 283, 341],
    route103: [72, 261, 263, 278, 279, 319, 320],
    route104: [129, 263, 265, 276, 278, 279],
    route105to109: [72, 278, 279, 320],
    route110: [43, 72, 263, 278, 279, 309, 311, 312, 316, 320],
    route111: [27, 183, 283, 328, 331, 339, 343],
    route112: [66, 322],
    route113: [27, 227, 327],
    route114: [183, 270, 271, 273, 274, 283, 333, 335, 336, 339],
    route115: [39, 72, 276, 277, 278, 279, 320, 333],
    route116: [263, 276, 290, 293, 300],
    route117: [43, 183, 263, 283, 313, 314, 315, 341],
    route118: [72, 263, 264, 278, 279, 309, 310, 318, 319, 352],
    route119: [43, 72, 263, 264, 278, 279, 318, 349, 352, 357],
    route120: [43, 183, 263, 264, 283, 339, 352, 359],
    route121and123: [43, 44, 72, 263, 264, 278, 279, 320, 352, 353, 355],
    hoennOpenSea: [72, 278, 279, 319, 320],
    route124and126: [72, 170, 278, 279, 319, 320, 366, 369],
    route128: [72, 222, 278, 279, 320, 370],
    route129: [72, 278, 279, 319, 320, 321],
    route130: [72, 278, 279, 319, 320, 360],
    route132to134: [72, 116, 278, 279, 319, 320],
  },
  landmarks: {
    petalburgWoods: [263, 265, 266, 268, 276, 285, 287],
    graniteCave: [41, 63, 74, 296, 302, 303, 304],
    fieryPath: [66, 88, 109, 218, 322, 324],
    jaggedPass: [66, 322, 325],
    meteorFalls: [41, 42, 337, 338, 339, 340, 371],
    newMauville: [81, 82, 100, 101],
    mtPyre: [37, 278, 307, 353, 355, 358],
    hoennSafariZone: [25, 43, 44, 54, 55, 84, 85, 111, 118, 119, 127, 177, 178, 202, 203, 214, 231],
    shoalCave: [41, 42, 72, 320, 361, 363],
    seafloorCavern: [41, 42, 72, 320],
    caveOfOrigin: [41, 42, 302, 303, 382, 383],
    skyPillar: [42, 302, 303, 334, 344, 354, 356, 384],
    hoennVictoryRoad: [41, 42, 293, 294, 296, 297, 302, 303, 304, 305, 307, 308, 339, 340],
  },
  // No Hoenn city has a card of its own
  placeCards: [
    /^Granite Cave$/,
    /^Meteor Falls$/,
    /^Sky Pillar$/,
    /^Desert Ruins$/,
    /^Island Cave$/,
    /^Ancient Tomb$/,
    /^Team Magma Hideout$/,
    /^Team Aqua Hideout$/,
    /^Battle Frontier$/,
  ],

  // The first EX sets, then the Omega Ruby & Alpha Sapphire era
  sets: {
    exHoennSets: ['ex1', 'ex2', 'ex3', 'ex4', 'ex5'],
    orasSets: ['xy5', 'xy6', 'dc1'],
  },
}
