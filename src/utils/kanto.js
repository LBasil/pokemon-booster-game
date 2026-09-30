// Kanto (Gen 1) data behind the Kanto achievements of src/utils/achievements.js.
// Pokémon groups are National Pokédex numbers; each id has its EN/FR title
// (achievements.items.<id>.title) and a description naming the members
// (achievements.desc.groups.<id>, official FR names): change a list, change
// both texts. Card groups match the card names of the database (English,
// from pokemontcg.io).

// Every evolution line of Red and Blue, Kanto Pokémon only (no babies or
// later evolutions: see KANTO_EXTRAS). Some ids predate this list.
export const KANTO_LINES = {
  bulbasaurLine: [1, 2, 3],
  charizardLine: [4, 5, 6],
  squirtleLine: [7, 8, 9],
  caterpieLine: [10, 11, 12],
  weedleLine: [13, 14, 15],
  pidgeyLine: [16, 17, 18],
  rattataLine: [19, 20],
  spearowLine: [21, 22],
  ekansLine: [23, 24],
  pikachuLine: [25, 26],
  sandshrewLine: [27, 28],
  nidoranFLine: [29, 30, 31],
  nidoranMLine: [32, 33, 34],
  clefairyLine: [35, 36],
  vulpixLine: [37, 38],
  jigglypuffLine: [39, 40],
  zubatLine: [41, 42],
  oddishLine: [43, 44, 45],
  parasLine: [46, 47],
  venonatLine: [48, 49],
  diglettLine: [50, 51],
  meowthLine: [52, 53],
  psyduckLine: [54, 55],
  mankeyLine: [56, 57],
  growlitheLine: [58, 59],
  poliwagLine: [60, 61, 62],
  abraLine: [63, 64, 65],
  machopLine: [66, 67, 68],
  bellsproutLine: [69, 70, 71],
  tentacoolLine: [72, 73],
  geodudeLine: [74, 75, 76],
  ponytaLine: [77, 78],
  slowpokeLine: [79, 80],
  magnemiteLine: [81, 82],
  doduoLine: [84, 85],
  seelLine: [86, 87],
  grimerLine: [88, 89],
  shellderLine: [90, 91],
  ghostLine: [92, 93, 94],
  drowzeeLine: [96, 97],
  krabbyLine: [98, 99],
  voltorbLine: [100, 101],
  exeggcuteLine: [102, 103],
  cuboneLine: [104, 105],
  koffingLine: [109, 110],
  rhyhornLine: [111, 112],
  horseaLine: [116, 117],
  goldeenLine: [118, 119],
  staryuLine: [120, 121],
  magikarpLine: [129, 130],
  eeveeLine: [133, 134, 135, 136],
  omanyteLine: [138, 139],
  kabutoLine: [140, 141],
  dratiniLine: [147, 148, 149],
}

// The rest of Kanto around those lines
export const KANTO_EXTRAS = {
  // Don't evolve in Red and Blue (legendaries aside: see LEGENDS)
  kantoSolos: [83, 95, 106, 107, 108, 113, 114, 115, 122, 123, 124, 125, 126, 127, 128, 131, 132, 137, 142, 143],
  // Babies added to Kanto lines later (Pichu, Cleffa... Munchlax)
  kantoBabies: [172, 173, 174, 236, 238, 239, 240, 439, 440, 446],
  // Evolutions later generations gave Kanto Pokémon (Eevee's are in eeveelutions)
  kantoNewEvolutions: [169, 182, 186, 199, 208, 212, 230, 233, 242, 462, 463, 464, 465, 466, 467, 474, 863, 865, 866, 900, 979],
  eeveelutions: [133, 134, 135, 136, 196, 197, 470, 471, 700],
  kantoFossils: [138, 140, 142],
}

// Regional forms of Kanto Pokémon, by card name ("Alolan Vulpix", "Alolan Vulpix-GX"...)
export const REGIONAL_FORMS = {
  alolanForms: ['Rattata', 'Raticate', 'Raichu', 'Sandshrew', 'Sandslash', 'Vulpix', 'Ninetales', 'Diglett', 'Dugtrio', 'Meowth', 'Persian', 'Geodude', 'Graveler', 'Golem', 'Grimer', 'Muk', 'Exeggutor', 'Marowak'].map((name) => `Alolan ${name}`),
  galarianForms: ['Meowth', 'Ponyta', 'Rapidash', 'Slowpoke', 'Slowbro', "Farfetch'd", 'Weezing', 'Mr. Mime', 'Articuno', 'Zapdos', 'Moltres'].map((name) => `Galarian ${name}`),
  hisuiPaldeaForms: ['Hisuian Growlithe', 'Hisuian Arcanine', 'Hisuian Voltorb', 'Hisuian Electrode', 'Paldean Tauros'],
}

// Wild Pokémon of Red and Blue (PokéAPI): on land, surfing, Super Rod, plus
// the one-off encounters (Snorlax, legendary birds, Mewtwo). The Old and Good
// Rods (Magikarp, Poliwag, Goldeen everywhere), gifts and trades are left out.
// Routes with the exact same Pokémon share one achievement.
export const KANTO_ROUTES = {
  route1: [16, 19],
  route2: [10, 13, 16, 19],
  route3: [16, 21, 39],
  route4and9: [19, 21, 23, 27],
  route5: [16, 43, 52, 56, 69],
  route6: [16, 43, 52, 56, 69, 90, 98],
  route7: [16, 37, 43, 52, 56, 58, 69],
  route8: [16, 23, 27, 37, 52, 56, 58],
  route10: [21, 23, 27, 61, 79, 100],
  route11: [21, 23, 27, 90, 96, 98],
  route12: [16, 43, 44, 48, 69, 70, 72, 98, 118, 129, 143],
  route13: [16, 43, 44, 48, 69, 70, 72, 98, 118, 129, 132],
  route14and15: [16, 17, 43, 44, 48, 69, 70, 132],
  route16: [19, 20, 21, 84, 143],
  route17and18: [20, 21, 22, 72, 84, 98, 118, 129],
  route19and20: [72, 90, 116, 118, 120],
  route21: [16, 17, 19, 20, 72, 90, 114, 116, 118, 120],
  route22: [19, 21, 29, 32, 60, 118],
  route23: [21, 22, 23, 24, 27, 28, 80, 99, 117, 119, 132],
  route24and25: [10, 11, 13, 14, 16, 43, 54, 63, 69, 98, 118],
}

// Caves, forests and buildings (same rules), and Mt. Silver (Gold and Silver)
export const KANTO_LANDMARKS = {
  viridianForest: [10, 11, 13, 14, 25],
  mtMoon: [35, 41, 46, 74],
  rockTunnel: [41, 66, 74, 95],
  diglettsCave: [50, 51],
  pokemonTower: [92, 93, 104],
  safariZone: [29, 30, 32, 33, 46, 47, 48, 49, 54, 79, 84, 98, 102, 111, 113, 115, 123, 127, 128, 147],
  powerPlant: [25, 26, 81, 82, 100, 101, 125, 145],
  seafoamIslands: [41, 42, 54, 55, 79, 80, 86, 87, 90, 98, 99, 116, 117, 118, 120, 144],
  pokemonMansion: [37, 58, 77, 88, 89, 109, 110, 126],
  ceruleanCave: [24, 26, 28, 40, 42, 47, 49, 64, 80, 82, 85, 97, 99, 101, 105, 112, 113, 117, 119, 132, 150],
  victoryRoad: [41, 42, 49, 66, 67, 74, 75, 95, 105, 146],
  mtSilver: [42, 55, 60, 61, 75, 77, 78, 84, 85, 95, 114, 118, 119, 129, 195, 200, 215, 217, 232, 246],
}

// Cities with a card of their own (their Gym stadiums, Lavender Town,
// Indigo Plateau). Pallet Town has none.
export const KANTO_CITIES = {
  viridianCity: /Viridian City/,
  pewterCity: /Pewter City/,
  ceruleanCity: /Cerulean City/,
  vermilionCity: /Vermilion City/,
  lavenderTown: /Lavender Town/,
  celadonCity: /Celadon City/,
  fuchsiaCity: /Fuchsia City/,
  saffronCity: /Saffron City/,
  cinnabarIsland: /Cinnabar/,
  indigoPlateau: /Indigo Plateau/,
}

// Kanto places printed as Stadium cards
export const KANTO_PLACE_CARDS = [/^Viridian Forest$/, /^Mt\. Moon$/, /^Power Plant$/, /^Pokémon Tower$/, /^Cycling Road$/, /^Rocket's Hideout$/]

// Cards bearing a trainer's name: their Pokémon ("Brock's Onix") and their
// Trainer cards ("Brock's Grit", "Misty & Lorelei")
export const GYM_LEADER_CARDS = {
  brock: /^Brock\b/,
  misty: /^Misty\b/,
  ltSurge: /^Lt\. Surge\b/,
  erika: /^Erika\b/,
  koga: /^Koga\b/,
  sabrina: /^Sabrina\b/,
  blaine: /^Blaine\b/,
  giovanni: /^(Team Rocket's )?Giovanni\b/,
}
export const ELITE_FOUR_CARDS = [/\bLorelei\b/, /^Bruno\b/, /^Agatha\b/, /^Lance\b/]
export const RIVAL_CARDS = [/^Red('s| &)/, /^Blue's|& Blue$/]
export const OAK_CARDS = /^(Professor|Prof\.) Oak\b|\(Professor Oak\)/
export const BILL_CARDS = /^Bill('s .+)?$|^Mail from Bill$/
export const TEAM_ROCKET_CARDS = /Rocket's|Team Rocket|^Jessie & James$/
export const IMPOSTOR_OAK = /^Impost[eo]r (Professor )?Oak/

// The first English sets, all Kanto: Base Set, Jungle, Fossil, Team Rocket, Gym Heroes, Gym Challenge
export const ORIGINAL_SETS = ['base1', 'base2', 'base3', 'base5', 'gym1', 'gym2']
