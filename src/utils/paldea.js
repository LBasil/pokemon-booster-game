// Paldea (Gen 9) data behind the Paldea achievements of src/utils/achievements.js,
// read by regionFocus() there (fields: see hoenn.js). Teams checked on
// Poképédia (Scarlet/Violet, first battle), card names in the database.
// No routes or landmarks: PokéAPI has no wild Pokémon for Scarlet and
// Violet, and its open areas would be as big as Galar's Wild Area.
export default {
  region: 'paldea',
  games: { en: 'Scarlet and Violet', fr: 'Écarlate et Violet' },
  dex: [906, 1025],
  dexTiers: [25, 50, 100],

  // Every evolution line of Scarlet and Violet that starts in Paldea (and
  // Poltchageist, the Teal Mask's). Some ids predate this list.
  lines: {
    sprigatitoLine: [906, 907, 908],
    fuecocoLine: [909, 910, 911],
    quaxlyLine: [912, 913, 914],
    lechonkLine: [915, 916],
    tarountulaLine: [917, 918],
    nymbleLine: [919, 920],
    pawmiLine: [921, 922, 923],
    tandemausLine: [924, 925],
    fidoughLine: [926, 927],
    smolivLine: [928, 929, 930],
    nacliLine: [932, 933, 934],
    charcadetLine: [935, 936, 937],
    tadbulbLine: [938, 939],
    wattrelLine: [940, 941],
    maschiffLine: [942, 943],
    shroodleLine: [944, 945],
    bramblinLine: [946, 947],
    toedscoolLine: [948, 949],
    capsakidLine: [951, 952],
    rellorLine: [953, 954],
    flittleLine: [955, 956],
    tinkatinkLine: [957, 958, 959],
    wiglettLine: [960, 961],
    finizenLine: [963, 964],
    varoomLine: [965, 966],
    glimmetLine: [969, 970],
    greavardLine: [971, 972],
    cetoddleLine: [974, 975],
    frigibaxLine: [996, 997, 998],
    gimmighoulLine: [999, 1000],
    poltchageistLine: [1012, 1013],
  },
  lineTiers: [10, 20],

  extras: {
    // Don't evolve (legendaries, mythicals and Paradox Pokémon aside)
    paldeaSolos: [931, 950, 962, 967, 968, 973, 976, 977, 978],
    // The Path of Legends' Titans (Great Tusk in Scarlet, Iron Treads in Violet)
    paldeaTitans: [950, 962, 968, 984, 990, 977, 978],
    // Paradox Pokémon, from the past (Scarlet) and from the future (Violet)
    ancientParadox: [984, 985, 986, 987, 988, 989, 1005, 1009, 1020, 1021],
    futureParadox: [990, 991, 992, 993, 994, 995, 1006, 1010, 1022, 1023],
  },

  // Gym leaders' teams (Scarlet/Violet), by gym. Champion Geeta is in CHAMPIONS
  gyms: {
    cortondoGym: [919, 917, 216], // Katy
    artazonGym: [548, 928, 185], // Brassius
    levinciaGym: [940, 404, 939, 429], // Iono
    cascarrafaGym: [976, 961, 740], // Kofu
    medaliGym: [775, 982, 398], // Larry
    monteneveraGym: [778, 972, 354, 849], // Ryme
    alfornadaGym: [981, 956, 282, 671], // Tulip
    glaseadoGym: [873, 975, 614, 334], // Grusha
  },
  // The Elite Four (Scarlet/Violet, first battle)
  eliteFour: {
    rika: [340, 51, 323, 980, 232],
    poppy: [879, 462, 823, 959, 437],
    larry: [357, 334, 741, 973, 398],
    hassel: [715, 841, 691, 998, 612],
  },
  // Arven's last battle, Penny as Cassiopeia, the AI professors at the Zero
  // Lab (Sada in Scarlet, Turo in Violet). Nemona's team depends on your starter
  people: {
    arven: [820, 952, 934, 91, 949, 943],
    penny: [197, 136, 134, 470, 135, 700],
    sada: [988, 986, 985, 989, 987, 1005],
    turo: [994, 993, 995, 992, 991, 1006],
  },

  // Larry is a gym leader and in the Elite Four: his cards count for both
  trainerCards: {
    tc_paldeaGymLeaders: { patterns: [/^Katy$/, /^Brassius$/, /^Iono\b/, /^Kofu$/, /^Larry\b/, /^Ryme$/, /^Tulip$/, /^Grusha$/] },
    tc_paldeaEliteFour: { patterns: [/^Rika$/, /^Poppy$/, /^Larry\b/, /^Hassel$/] },
    tc_geeta: { pattern: /^Geeta$/, target: 1 },
    tc_paldeaFriends: { patterns: [/^Nemona\b/, /^Arven\b/, /^Penny$/] },
    tc_paldeaProfessors: { patterns: [/^Professor Sada\b/, /^Professor Turo\b/] },
    tc_teamStar: { patterns: [/^Giacomo$/, /^Mela$/, /^Atticus$/, /^Ortega$/, /^Eri$/] },
    tc_academy: { patterns: [/^Clavell$/, /^Jacq$/, /^Dendra$/, /^Saguaro$/, /^Raifort$/, /^Tyme$/, /^Salvatore$/, /^Miriam$/] },
  },

  cities: {
    mesagoza: /^Mesagoza$/,
    artazon: /^Artazon$/,
    levincia: /^Levincia$/,
  },
  placeCards: [/^Area Zero Underdepths$/, /^Academy at Night$/],

  // Scarlet & Violet's numbered sets (Black Bolt and White Flare are
  // Unova's), then its special sets (151 aside: Kanto's)
  sets: {
    paldeaSets: ['sv1', 'sv2', 'sv3', 'sv4', 'sv5', 'sv6', 'sv7', 'sv8', 'sv9', 'sv10'],
    paldeaSpecialSets: ['sv4pt5', 'sv6pt5', 'sv8pt5'],
  },
}
