// Galar (Gen 8) data behind the Galar achievements of src/utils/achievements.js,
// read by regionFocus() there (fields: see hoenn.js). Teams checked on
// Poképédia (Sword/Shield, first battle), card names in the database. The
// range runs to #905: Hisui's Pokémon are in sinnoh.js and the older
// regions' new evolutions.
export default {
  region: 'galar',
  games: { en: 'Sword and Shield', fr: 'Épée et Bouclier' },
  dex: [810, 905],
  dexTiers: [25, 50],

  // Every evolution line of Sword and Shield that starts in Galar (Kubfu
  // is with the legends). Some ids predate this list.
  lines: {
    grookeyLine: [810, 811, 812],
    scorbunnyLine: [813, 814, 815],
    sobbleLine: [816, 817, 818],
    skwovetLine: [819, 820],
    rookideeLine: [821, 822, 823],
    blipbugLine: [824, 825, 826],
    nickitLine: [827, 828],
    gossifleurLine: [829, 830],
    woolooLine: [831, 832],
    chewtleLine: [833, 834],
    yamperLine: [835, 836],
    rolycolyLine: [837, 838, 839],
    applinLine: [840, 841, 842],
    silicobraLine: [843, 844],
    arrokudaLine: [846, 847],
    toxelLine: [848, 849],
    sizzlipedeLine: [850, 851],
    clobbopusLine: [852, 853],
    sinisteaLine: [854, 855],
    hatennaLine: [856, 857, 858],
    impidimpLine: [859, 860, 861],
    milceryLine: [868, 869],
    snomLine: [872, 873],
    cufantLine: [878, 879],
    dreepyLine: [885, 886, 887],
  },
  lineTiers: [10],

  extras: {
    // Don't evolve in Sword and Shield (legendaries and mythicals aside)
    galarSolos: [845, 870, 871, 874, 875, 876, 877, 880, 881, 882, 883, 884],
    // The four fossil Pokémon put together from two halves
    galarFossils: [880, 881, 882, 883],
    // Evolutions Scarlet and Violet gave Galar Pokémon (Dipplin, Archaludon, Hydrapple)
    galarNewEvolutions: [1011, 1018, 1019],
  },

  // Gym leaders' teams (Sword/Shield, gym challenge), by badge. Bea and
  // Gordie are Sword's, Allister and Melony Shield's
  gyms: {
    galarGrassBadge: [829, 830], // Milo
    galarWaterBadge: [118, 846, 834], // Nessa
    galarFireBadge: [38, 59, 851], // Kabu
    galarFightingBadge: [237, 865, 675, 68], // Bea
    galarGhostBadge: [562, 864, 778, 94], // Allister
    galarFairyBadge: [110, 468, 303, 869], // Opal
    galarRockBadge: [689, 874, 213, 839], // Gordie
    galarIceBadge: [873, 875, 555, 131], // Melony
    galarDarkBadge: [560, 435, 687, 862], // Piers
    galarDragonBadge: [526, 844, 330, 884], // Raihan
  },
  // No Elite Four in Galar (Champion Leon is in CHAMPIONS). Marnie and Bede
  // in the Champion Cup, Chairman Rose and Oleana at Rose Tower (Hop's team
  // depends on your starter)
  people: {
    marnie: [510, 877, 454, 861, 560],
    bede: [303, 78, 282, 858],
    rose: [589, 601, 598, 879, 863],
    oleana: [478, 350, 763, 569, 758],
  },

  // Expansion Pass trainers: Isle of Armor only (no Mustard card yet)
  trainerCards: {
    tc_galarGymLeaders: {
      patterns: [/^Milo$/, /^Nessa$/, /^Kabu$/, /^Bea$/, /^Allister$/, /^Opal$/, /^Gordie$/, /^Melony$/, /^Piers$/, /^Raihan$/],
    },
    tc_leon: { pattern: /^Leon$/, target: 1 },
    tc_galarRivals: { patterns: [/^Hop\b/, /^Marnie\b/, /^Bede$/] },
    tc_sonia: { pattern: /^Sonia$/, target: 1 },
    tc_macroCosmos: { patterns: [/^Rose$/, /^Oleana$/] },
    tc_teamYell: { pattern: /^Team Yell\b/, target: 5 },
    tc_isleOfArmor: { patterns: [/^Klara$/, /^Avery$/, /^Honey$/] },
  },

  // Wild Pokémon of Sword and Shield (`region-tools.mjs encounters 8
  // sword,shield`: random and visible encounters, wanderers, Max Raids and
  // berry trees left out). The Wild Area's zones are left out (user,
  // 2026-10-01: up to 87 Pokémon each), and so are the towns and the
  // Energy Plant (the legends).
  routes: {
    galarRoute1: [10, 163, 736, 819, 821, 824, 827, 831],
    galarRoute2: [130, 131, 163, 263, 270, 273, 509, 819, 821, 824, 827, 829, 833, 834, 835, 846, 847, 862],
    galarRoute3: [37, 58, 66, 236, 263, 434, 568, 599, 674, 749, 821, 829, 837, 850],
    galarRoute4: [25, 52, 133, 309, 406, 595, 597, 710, 742, 831, 835, 868],
    galarRoute5: [83, 202, 271, 274, 290, 425, 572, 677, 682, 684, 751, 759, 825, 830, 840],
    galarRoute6: [51, 324, 328, 355, 449, 451, 556, 562, 610, 631, 632, 694, 701, 843],
    galarRoute7: [510, 537, 588, 596, 616, 678, 686, 823, 828, 848, 863, 877],
    galarRoute8: [93, 111, 215, 225, 337, 338, 356, 361, 437, 450, 452, 459, 525, 533, 538, 539, 554, 558, 583, 622, 624, 627, 629, 777, 844, 870, 872],
    galarRoute9: [99, 211, 223, 224, 226, 279, 320, 362, 423, 458, 510, 593, 686, 689, 712, 747, 748, 771, 781, 828, 845, 852, 863, 871, 877],
    galarRoute10: [112, 122, 215, 362, 459, 460, 554, 583, 584, 600, 613, 614, 872, 874, 875, 884],
  },
  landmarks: {
    slumberingWeald: [12, 110, 163, 517, 618, 736, 819, 821, 823, 824, 826],
    galarMine: [50, 524, 527, 529, 532, 837],
    motostokeOutskirts: [109, 164, 185, 453, 524, 538, 539, 559, 624, 757, 833, 856, 859],
    galarMineNo2: [213, 422, 423, 453, 559, 688, 714, 767, 833, 834],
    glimwoodTangle: [77, 682, 684, 708, 756, 765, 766, 854, 857, 860, 876],
  },
  // Stadiums and gyms named after their town
  cities: {
    postwick: /^Postwick$/,
    turffield: /^Turffield Stadium$/,
    circhester: /^Circhester Bath$/,
    spikemuth: /^Spikemuth( Gym)?$/,
    wyndon: /^Wyndon Stadium$/,
  },
  placeCards: [/^Galar Mine$/, /^Glimwood Tangle$/, /^Rose Tower$/, /^Dyna Tree Hill$/, /^Tower of Darkness$/, /^Tower of Waters$/, /^Path to the Peak$/],

  // Sword & Shield's sets set in Galar (Brilliant Stars to Lost Origin are
  // Hisui's: sinnoh.js), then its special sets
  sets: {
    galarSets: ['swsh1', 'swsh2', 'swsh3', 'swsh4', 'swsh5', 'swsh6', 'swsh7', 'swsh8'],
    galarSpecialSets: ['swsh35', 'swsh45', 'swsh12pt5'],
  },
}
