// Alola (Gen 7) data behind the Alola achievements of src/utils/achievements.js,
// read by regionFocus() there (fields: see hoenn.js). Teams checked on
// Poképédia (Sun/Moon, first battle), card names in the database. Alola has
// no gyms: `gyms` are the island kahunas' grand trials.
export default {
  region: 'alola',
  games: { en: 'Sun and Moon', fr: 'Soleil et Lune' },
  dex: [722, 809],
  dexTiers: [25, 50],

  // Every evolution line of Sun and Moon that starts in Alola (Type: Null,
  // Cosmog, Poipole and Meltan are with the legends). Some ids predate this list.
  lines: {
    rowletLine: [722, 723, 724],
    littenLine: [725, 726, 727],
    popplioLine: [728, 729, 730],
    pikipekLine: [731, 732, 733],
    yungoosLine: [734, 735],
    grubbinLine: [736, 737, 738],
    crabrawlerLine: [739, 740],
    cutieflyLine: [742, 743],
    rockruffLine: [744, 745],
    mareanieLine: [747, 748],
    mudbrayLine: [749, 750],
    dewpiderLine: [751, 752],
    fomantisLine: [753, 754],
    morelullLine: [755, 756],
    salanditLine: [757, 758],
    stuffulLine: [759, 760],
    bounsweetLine: [761, 762, 763],
    wimpodLine: [767, 768],
    sandygastLine: [769, 770],
    jangmooLine: [782, 783, 784],
  },
  lineTiers: [10],

  extras: {
    // Don't evolve (legendaries, mythicals and Ultra Beasts aside)
    alolaSolos: [741, 746, 764, 765, 766, 771, 774, 775, 776, 777, 778, 779, 780, 781],
    // The trials' totems (Gumshoos in Sun, Raticate in Moon), Kommo-o's on
    // Vast Poni Canyon included
    alolaTotems: [20, 735, 746, 758, 754, 738, 778, 784],
  },

  // Island kahunas' grand trials (Sun/Moon), by island
  gyms: {
    melemeleTrial: [56, 296, 739], // Hala
    akalaTrial: [299, 525, 745], // Olivia
    ulaulaTrial: [302, 552, 53], // Nanu
    poniTrial: [51, 750, 423, 330], // Hapu
  },
  // The Elite Four (Sun/Moon, first battle)
  eliteFour: {
    hala: [297, 62, 57, 740, 760],
    olivia: [369, 476, 703, 745, 76],
    acerola: [302, 478, 426, 770, 781],
    kahili: [227, 733, 630, 169, 741],
  },
  // Lusamine in Ultra Space, Guzma's last battle, Kukui at the League (the
  // members that don't depend on your starter)
  people: {
    lusamine: [36, 549, 760, 350, 429],
    guzma: [768, 168, 284, 212, 127],
    kukui: [745, 143, 38, 462, 628],
  },

  // Molayne (Ultra Sun/Moon) aside. Hala also counts on "Guzma & Hala"
  trainerCards: {
    tc_alolaKahunas: { patterns: [/^Hala$|& Hala$/, /^Olivia$/, /^Nanu$/, /^Hapu$/] },
    tc_alolaCaptains: { patterns: [/^Ilima$/, /^Lana\b|& Lana$/, /^Kiawe$/, /^Mallow\b/, /^Sophocles$/, /^Acerola\b/, /^Mina$/] },
    tc_alolaEliteFour: { patterns: [/^Hala$|& Hala$/, /^Olivia$/, /^Acerola\b/, /^Kahili$/] },
    tc_kukui: { pattern: /^Professor Kukui$/, target: 1 },
    tc_lillie: { pattern: /^Lillie\b/, target: 5 },
    tc_alolaFriends: { patterns: [/^Hau$/, /^Gladion\b/] },
    tc_aether: { pattern: /^(Lusamine|Faba|Wicke)\b|^Aether\b/, target: 8 },
    tc_teamSkull: { pattern: /^(Guzma|Plumeria|Team Skull)\b|^Po Town$/, target: 8 },
  },

  // Wild Pokémon of Sun and Moon (`region-tools.mjs encounters 7 sun,moon`:
  // SOS calls, Island Scan, bubbling spots and berry trees left out, forms
  // count as their species). Towns and cities, the ruins and altars (one
  // legend each) are left out.
  routes: {
    alolaRoute1: [10, 11, 19, 52, 72, 79, 81, 88, 165, 167, 172, 278, 438, 446, 456, 731, 734, 736],
    alolaRoute2: [19, 21, 52, 58, 63, 96, 235, 734, 742],
    alolaRoute3: [19, 21, 56, 225, 371, 734, 742],
    alolaRoute4: [19, 133, 174, 506, 731, 734, 736, 749],
    alolaRoute5: [10, 11, 12, 506, 731, 736, 753],
    alolaRoute6: [19, 133, 174, 506, 731, 734, 736, 741, 749],
    alolaRoute7: [72, 120, 129, 278, 456, 746, 771],
    alolaRoute8: [19, 129, 170, 662, 732, 734, 746, 757, 759, 767],
    alolaRoute9: [129, 222, 370, 746],
    alolaRoute10: [20, 22, 166, 168, 227, 674, 735],
    alolaRoute11: [20, 46, 166, 168, 674, 732, 735, 755, 775],
    alolaRoute12: [74, 239, 324, 749],
    alolaRoute13: [129, 746, 779],
    alolaRoute14: [20, 27, 37, 72, 129, 279, 359, 361, 456, 735, 746, 779],
    alolaRoute15: [20, 72, 79, 129, 279, 456, 735, 746, 779],
    alolaRoute16: [20, 79, 279, 735],
    alolaRoute17: [20, 22, 75, 166, 168, 227, 674, 735, 798],
  },
  landmarks: {
    kalaeBay: [19, 72, 79, 90, 129, 278, 371, 456, 734, 746],
    melemeleSea: [72, 129, 222, 278, 370, 456, 746],
    tenCaratHill: [41, 50, 66, 327, 524, 703, 744, 800],
    hauoliCemetery: [41, 92, 200, 425],
    melemeleMeadow: [10, 11, 12, 546, 548, 741, 742, 794],
    seawardCave: [41, 50, 54, 129, 339],
    hanoBeach: [72, 120, 278, 456, 769, 771],
    memorialHill: [41, 92, 708, 796],
    paniolaRanch: [128, 241, 506, 749],
    welaVolcanoPark: [104, 115, 240, 661, 757, 793],
    brookletHill: [46, 54, 60, 72, 118, 129, 278, 283, 349, 456, 506, 594, 746, 751, 755],
    lushJungle: [10, 11, 41, 46, 50, 127, 438, 732, 753, 755, 761, 764, 765, 766, 796],
    akalaOutskirts: [20, 278, 299, 735, 759],
    diglettsTunnel: [41, 50, 793],
    secludedShore: [72, 129, 279, 456, 746, 779],
    hainaDesert: [51, 551, 797],
    ulaulaMeadow: [166, 168, 546, 548, 741, 743],
    malieGarden: [52, 54, 60, 118, 129, 166, 168, 284, 546, 548, 752, 797, 798],
    mountHokulani: [22, 132, 173, 227, 374, 774],
    blushMountain: [74, 239, 324, 737, 749, 776, 777],
    mountLanakila: [27, 37, 42, 215, 359, 361, 780],
    poniMeadow: [129, 147, 339, 546, 548, 741, 743],
    poniWilds: [20, 73, 102, 129, 131, 210, 279, 320, 369, 423, 457, 735, 767],
    ancientPoniPath: [20, 102, 210, 279, 423, 735],
    poniBreakerCoast: [129, 319, 320, 767],
    poniGrove: [20, 127, 210, 447, 732, 735],
    poniPlains: [20, 22, 97, 128, 241, 279, 546, 548, 732, 735, 750],
    poniGauntlet: [20, 55, 129, 147, 210, 279, 339, 735, 760],
    vastPoniCanyon: [42, 51, 55, 67, 129, 147, 198, 227, 339, 525, 703, 745, 782],
    resolutionCave: [42, 51, 799],
    exeggutorIsland: [102, 103, 279, 423],
    verdantCavern: [41, 50, 795],
    thriftyMegamart: [42, 93, 707, 778],
  },
  // Po Town is the only town with a card: with the places
  placeCards: [/^Aether Paradise Conservation Area$/, /^Brooklet Hill$/, /^Wela Volcano Park$/, /^Mount Lanakila$/, /^Po Town$/, /^Altar of the Sunne$/, /^Altar of the Moone$/],

  // Sun & Moon's numbered sets (Shining Legends, Dragon Majesty and Hidden
  // Fates aside)
  sets: {
    smSets: ['sm1', 'sm2', 'sm3', 'sm4', 'sm5', 'sm6', 'sm7', 'sm8', 'sm9', 'sm10', 'sm11', 'sm12'],
  },
}
