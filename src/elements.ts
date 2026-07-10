// Periodic table, Z = 1 (H) through 82 (Pb).
// Fields per row: [Z, symbol, name, atomic mass, Pauling electronegativity (null = noble/none),
//                  covalent radius pm (Cordero 2008), maxBonds (typical bonding capacity), category, CPK color (Jmol)]
// maxBonds is deliberately a single "typical valence" integer — real valence is context-
// dependent (S: 2/4/6) but one auditable number keeps the sim legible. See build plan D2.

const CATEGORIES = {
  nm: 'nonmetal',
  ng: 'noble gas',
  am: 'alkali metal',
  ae: 'alkaline earth',
  md: 'metalloid',
  hg: 'halogen',
  tm: 'transition metal',
  pt: 'post-transition metal',
  ln: 'lanthanide',
} as const;

type CategoryCode = keyof typeof CATEGORIES;

export interface ChemElement {
  z: number;
  symbol: string;
  name: string;
  mass: number;
  en: number | null;
  radius: number;
  maxBonds: number;
  category: (typeof CATEGORIES)[CategoryCode];
  cpk: string;
  noble: boolean;
  metal: boolean;
}

type Row = [number, string, string, number, number | null, number, number, CategoryCode, string];

const ROWS: Row[] = [
  [1,  'H',  'Hydrogen',      1.008,  2.20, 31,  1, 'nm', '#FFFFFF'],
  [2,  'He', 'Helium',        4.003,  null, 28,  0, 'ng', '#D9FFFF'],
  [3,  'Li', 'Lithium',       6.94,   0.98, 128, 1, 'am', '#CC80FF'],
  [4,  'Be', 'Beryllium',     9.012,  1.57, 96,  2, 'ae', '#C2FF00'],
  [5,  'B',  'Boron',         10.81,  2.04, 84,  3, 'md', '#FFB5B5'],
  [6,  'C',  'Carbon',        12.011, 2.55, 76,  4, 'nm', '#909090'],
  [7,  'N',  'Nitrogen',      14.007, 3.04, 71,  3, 'nm', '#3050F8'],
  [8,  'O',  'Oxygen',        15.999, 3.44, 66,  2, 'nm', '#FF0D0D'],
  [9,  'F',  'Fluorine',      18.998, 3.98, 57,  1, 'hg', '#90E050'],
  [10, 'Ne', 'Neon',          20.180, null, 58,  0, 'ng', '#B3E3F5'],
  [11, 'Na', 'Sodium',        22.990, 0.93, 166, 1, 'am', '#AB5CF2'],
  [12, 'Mg', 'Magnesium',     24.305, 1.31, 141, 2, 'ae', '#8AFF00'],
  [13, 'Al', 'Aluminium',     26.982, 1.61, 121, 3, 'pt', '#BFA6A6'],
  [14, 'Si', 'Silicon',       28.085, 1.90, 111, 4, 'md', '#F0C8A0'],
  [15, 'P',  'Phosphorus',    30.974, 2.19, 107, 3, 'nm', '#FF8000'],
  [16, 'S',  'Sulfur',        32.06,  2.58, 105, 2, 'nm', '#FFFF30'],
  [17, 'Cl', 'Chlorine',      35.45,  3.16, 102, 1, 'hg', '#1FF01F'],
  [18, 'Ar', 'Argon',         39.948, null, 106, 0, 'ng', '#80D1E3'],
  [19, 'K',  'Potassium',     39.098, 0.82, 203, 1, 'am', '#8F40D4'],
  [20, 'Ca', 'Calcium',       40.078, 1.00, 176, 2, 'ae', '#3DFF00'],
  [21, 'Sc', 'Scandium',      44.956, 1.36, 170, 2, 'tm', '#E6E6E6'],
  [22, 'Ti', 'Titanium',      47.867, 1.54, 160, 2, 'tm', '#BFC2C7'],
  [23, 'V',  'Vanadium',      50.942, 1.63, 153, 2, 'tm', '#A6A6AB'],
  [24, 'Cr', 'Chromium',      51.996, 1.66, 139, 2, 'tm', '#8A99C7'],
  [25, 'Mn', 'Manganese',     54.938, 1.55, 139, 2, 'tm', '#9C7AC7'],
  [26, 'Fe', 'Iron',          55.845, 1.83, 132, 2, 'tm', '#E06633'],
  [27, 'Co', 'Cobalt',        58.933, 1.88, 126, 2, 'tm', '#F090A0'],
  [28, 'Ni', 'Nickel',        58.693, 1.91, 124, 2, 'tm', '#50D050'],
  [29, 'Cu', 'Copper',        63.546, 1.90, 132, 2, 'tm', '#C88033'],
  [30, 'Zn', 'Zinc',          65.38,  1.65, 122, 2, 'tm', '#7D80B0'],
  [31, 'Ga', 'Gallium',       69.723, 1.81, 122, 3, 'pt', '#C28F8F'],
  [32, 'Ge', 'Germanium',     72.630, 2.01, 120, 4, 'md', '#668F8F'],
  [33, 'As', 'Arsenic',       74.922, 2.18, 119, 3, 'md', '#BD80E3'],
  [34, 'Se', 'Selenium',      78.971, 2.55, 120, 2, 'nm', '#FFA100'],
  [35, 'Br', 'Bromine',       79.904, 2.96, 120, 1, 'hg', '#A62929'],
  [36, 'Kr', 'Krypton',       83.798, null, 116, 0, 'ng', '#5CB8D1'],
  [37, 'Rb', 'Rubidium',      85.468, 0.82, 220, 1, 'am', '#702EB0'],
  [38, 'Sr', 'Strontium',     87.62,  0.95, 195, 2, 'ae', '#00FF00'],
  [39, 'Y',  'Yttrium',       88.906, 1.22, 190, 2, 'tm', '#94FFFF'],
  [40, 'Zr', 'Zirconium',     91.224, 1.33, 175, 2, 'tm', '#94E0E0'],
  [41, 'Nb', 'Niobium',       92.906, 1.60, 164, 2, 'tm', '#73C2C9'],
  [42, 'Mo', 'Molybdenum',    95.95,  2.16, 154, 2, 'tm', '#54B5B5'],
  [43, 'Tc', 'Technetium',    98,     1.90, 147, 2, 'tm', '#3B9E9E'],
  [44, 'Ru', 'Ruthenium',     101.07, 2.20, 146, 2, 'tm', '#248F8F'],
  [45, 'Rh', 'Rhodium',       102.91, 2.28, 142, 2, 'tm', '#0A7D8C'],
  [46, 'Pd', 'Palladium',     106.42, 2.20, 139, 2, 'tm', '#006985'],
  [47, 'Ag', 'Silver',        107.87, 1.93, 145, 1, 'tm', '#C0C0C0'],
  [48, 'Cd', 'Cadmium',       112.41, 1.69, 144, 2, 'tm', '#FFD98F'],
  [49, 'In', 'Indium',        114.82, 1.78, 142, 3, 'pt', '#A67573'],
  [50, 'Sn', 'Tin',           118.71, 1.96, 139, 4, 'pt', '#668080'],
  [51, 'Sb', 'Antimony',      121.76, 2.05, 139, 3, 'md', '#9E63B5'],
  [52, 'Te', 'Tellurium',     127.60, 2.10, 138, 2, 'md', '#D47A00'],
  [53, 'I',  'Iodine',        126.90, 2.66, 139, 1, 'hg', '#940094'],
  [54, 'Xe', 'Xenon',         131.29, null, 140, 0, 'ng', '#429EB0'],
  [55, 'Cs', 'Caesium',       132.91, 0.79, 244, 1, 'am', '#57178F'],
  [56, 'Ba', 'Barium',        137.33, 0.89, 215, 2, 'ae', '#00C900'],
  [57, 'La', 'Lanthanum',     138.91, 1.10, 207, 3, 'ln', '#70D4FF'],
  [58, 'Ce', 'Cerium',        140.12, 1.12, 204, 3, 'ln', '#FFFFC7'],
  [59, 'Pr', 'Praseodymium',  140.91, 1.13, 203, 3, 'ln', '#D9FFC7'],
  [60, 'Nd', 'Neodymium',     144.24, 1.14, 201, 3, 'ln', '#C7FFC7'],
  [61, 'Pm', 'Promethium',    145,    1.13, 199, 3, 'ln', '#A3FFC7'],
  [62, 'Sm', 'Samarium',      150.36, 1.17, 198, 3, 'ln', '#8FFFC7'],
  [63, 'Eu', 'Europium',      151.96, 1.20, 198, 3, 'ln', '#61FFC7'],
  [64, 'Gd', 'Gadolinium',    157.25, 1.20, 196, 3, 'ln', '#45FFC7'],
  [65, 'Tb', 'Terbium',       158.93, 1.10, 194, 3, 'ln', '#30FFC7'],
  [66, 'Dy', 'Dysprosium',    162.50, 1.22, 192, 3, 'ln', '#1FFFC7'],
  [67, 'Ho', 'Holmium',       164.93, 1.23, 192, 3, 'ln', '#00FF9C'],
  [68, 'Er', 'Erbium',        167.26, 1.24, 189, 3, 'ln', '#00E675'],
  [69, 'Tm', 'Thulium',       168.93, 1.25, 190, 3, 'ln', '#00D452'],
  [70, 'Yb', 'Ytterbium',     173.05, 1.10, 187, 3, 'ln', '#00BF38'],
  [71, 'Lu', 'Lutetium',      174.97, 1.27, 187, 3, 'ln', '#00AB24'],
  [72, 'Hf', 'Hafnium',       178.49, 1.30, 175, 2, 'tm', '#4DC2FF'],
  [73, 'Ta', 'Tantalum',      180.95, 1.50, 170, 2, 'tm', '#4DA6FF'],
  [74, 'W',  'Tungsten',      183.84, 2.36, 162, 2, 'tm', '#2194D6'],
  [75, 'Re', 'Rhenium',       186.21, 1.90, 151, 2, 'tm', '#267DAB'],
  [76, 'Os', 'Osmium',        190.23, 2.20, 144, 2, 'tm', '#266696'],
  [77, 'Ir', 'Iridium',       192.22, 2.20, 141, 2, 'tm', '#175487'],
  [78, 'Pt', 'Platinum',      195.08, 2.28, 136, 2, 'tm', '#D0D0E0'],
  [79, 'Au', 'Gold',          196.97, 2.54, 136, 1, 'tm', '#FFD123'],
  [80, 'Hg', 'Mercury',       200.59, 2.00, 132, 2, 'tm', '#B8B8D0'],
  [81, 'Tl', 'Thallium',      204.38, 1.62, 145, 1, 'pt', '#A6544D'],
  [82, 'Pb', 'Lead',          207.2,  2.33, 146, 2, 'pt', '#575961'],
];

export const ELEMENTS: ChemElement[] = ROWS.map(([z, symbol, name, mass, en, radius, maxBonds, cat, cpk]) => ({
  z, symbol, name, mass, en, radius, maxBonds,
  category: CATEGORIES[cat],
  cpk,
  noble: cat === 'ng',
  metal: cat === 'am' || cat === 'ae' || cat === 'tm' || cat === 'pt' || cat === 'ln',
}));

export const BY_SYMBOL: Record<string, ChemElement> = Object.fromEntries(ELEMENTS.map(e => [e.symbol, e]));
