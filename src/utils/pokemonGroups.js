// Groups of Pokémon (National Pokédex numbers) behind the "own them all"
// achievements of src/utils/achievements.js. Each id has its EN/FR title
// (achievements.items.<id>.title) and description naming the members
// (achievements.desc.groups.<id>): change the list, change both texts.

// Whole evolution lines (first stage to last) of the regions without a
// file of their own yet (Kanto: kanto.js, then johto.js, hoenn.js, sinnoh.js, unova.js)
export const FAMILIES = {
  chespinLine: [650, 651, 652],
  fennekinLine: [653, 654, 655],
  froakieLine: [656, 657, 658],
  goomyLine: [704, 705, 706],
  rowletLine: [722, 723, 724],
  littenLine: [725, 726, 727],
  popplioLine: [728, 729, 730],
  jangmooLine: [782, 783, 784],
  grookeyLine: [810, 811, 812],
  scorbunnyLine: [813, 814, 815],
  sobbleLine: [816, 817, 818],
  dreepyLine: [885, 886, 887],
  sprigatitoLine: [906, 907, 908],
  fuecocoLine: [909, 910, 911],
  quaxlyLine: [912, 913, 914],
  frigibaxLine: [996, 997, 998],
}

// Every region's three starters (first stage), Kanto to Paldea
export const STARTERS = [1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501, 650, 653, 656, 722, 725, 728, 810, 813, 816, 906, 909, 912]
export const STARTER_FINALS = STARTERS.map((number) => number + 2)
export const PSEUDO_LEGENDS = [149, 248, 373, 376, 445, 635, 706, 784, 887, 998]

// Each region's starter trio (first stage)
export const STARTER_TRIOS = {
  kantoStarters: [1, 4, 7],
  johtoStarters: [152, 155, 158],
  hoennStarters: [252, 255, 258],
  sinnohStarters: [387, 390, 393],
  unovaStarters: [495, 498, 501],
  kalosStarters: [650, 653, 656],
  alolaStarters: [722, 725, 728],
  galarStarters: [810, 813, 816],
  paldeaStarters: [906, 909, 912],
}

// Legendary (not mythical) Pokémon, and mythical ones
export const LEGENDARIES = [
  144, 145, 146, 150, 243, 244, 245, 249, 250, 377, 378, 379, 380, 381, 382, 383, 384, 480, 481, 482, 483, 484, 485, 486, 487, 488, 638,
  639, 640, 641, 642, 643, 644, 645, 646, 716, 717, 718, 772, 773, 785, 786, 787, 788, 789, 790, 791, 792, 800, 888, 889, 890, 891, 892,
  894, 895, 896, 897, 898, 905, 1001, 1002, 1003, 1004, 1007, 1008, 1014, 1015, 1016, 1017, 1024,
]
export const MYTHICALS = [151, 251, 385, 386, 489, 490, 491, 492, 493, 494, 647, 648, 649, 719, 720, 721, 801, 802, 807, 808, 809, 893, 1025]
export const ULTRA_BEASTS = [793, 794, 795, 796, 797, 798, 799, 803, 804, 805, 806]

// Legendary groups, region by region
export const LEGENDS = {
  legendaryBirds: [144, 145, 146],
  mewDuo: [150, 151],
  legendaryBeasts: [243, 244, 245],
  towerDuo: [249, 250],
  regiTrio: [377, 378, 379],
  allRegis: [377, 378, 379, 486, 894, 895],
  eonDuo: [380, 381],
  weatherTrio: [382, 383, 384],
  lakeGuardians: [480, 481, 482],
  creationTrio: [483, 484, 487],
  lunarDuo: [488, 491],
  swordsOfJustice: [638, 639, 640],
  forcesOfNature: [641, 642, 645, 905],
  taoTrio: [643, 644, 646],
  kalosLegends: [716, 717, 718],
  tapus: [785, 786, 787, 788],
  alolaLegends: [791, 792, 800],
  galarHeroes: [888, 889],
  galarSteeds: [896, 897, 898],
  treasuresOfRuin: [1001, 1002, 1003, 1004],
  paldeaLegends: [1007, 1008],
}

// Kanto gym leaders' teams (Red/Blue), by badge. Other regions': their file (johto.js...)
export const KANTO_GYMS = {
  boulderBadge: [74, 95], // Brock
  cascadeBadge: [120, 121], // Misty
  thunderBadge: [100, 25, 26], // Lt. Surge
  rainbowBadge: [71, 114, 45], // Erika
  soulBadge: [109, 89, 110], // Koga
  marshBadge: [64, 122, 49, 65], // Sabrina
  volcanoBadge: [58, 77, 78, 59], // Blaine
  earthBadge: [111, 51, 31, 34, 112], // Giovanni
}

// Kanto's Elite Four (Red/Blue), then champions' teams (their games' final battle)
export const ELITE_FOUR = {
  lorelei: [87, 91, 80, 124, 131],
  bruno: [95, 107, 106, 68],
  agatha: [94, 42, 93, 24],
  lance: [130, 148, 142, 149],
}
export const CHAMPIONS = {
  blue: [18, 65, 112, 130, 59, 103], // HeartGold/SoulSilver
  lanceJohto: [130, 149, 142, 6], // Gold/Silver
  steven: [227, 344, 306, 346, 348, 376], // Ruby/Sapphire
  wallace: [321, 73, 272, 340, 130, 350], // Emerald
  cynthia: [442, 407, 423, 448, 350, 445], // Diamond/Pearl
  alder: [617, 626, 621, 584, 589, 637], // Black/White
  iris: [635, 621, 306, 567, 131, 612], // Black 2/White 2
  diantha: [701, 697, 699, 711, 706, 282], // X/Y
  leon: [681, 887, 612, 6], // Sword/Shield (his team's constant members)
}

// Rivals and famous trainers
export const RIVALS = {
  red: [25, 196, 143, 3, 6, 9], // Mt. Silver
  silver: [215, 169, 82, 94, 65], // Gold/Silver (his starter depends on yours)
  ashKanto: [25, 12, 17, 1, 6, 7], // the anime's first season
  ashChampion: [25, 448, 149, 94, 865, 882], // world champion (Journeys)
  teamRocket: [23, 109, 52, 24, 110, 202], // Jessie, James and Meowth
}
