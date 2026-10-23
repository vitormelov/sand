import type { GeoRef, WorldRegion } from '../types';
import { escapeRegex, normalizeForMatch, stripAccents } from '../text';

/**
 * Compact gazetteer used for deterministic place detection.
 *
 * Matching is case-sensitive on the original text so that common words
 * ("natal", "para") are not mistaken for places. Ambiguous names that are
 * frequent ordinary words (Natal, Vitória, Palmas, Jordan, Georgia...) are
 * deliberately left out — missing a place is better than inventing one.
 */

const R = {
  SA: 'south_america',
  CA: 'central_america_caribbean',
  NA: 'north_america',
  EU: 'europe',
  AF: 'africa',
  ME: 'middle_east',
  SAS: 'south_asia',
  EAS: 'east_asia',
  SEA: 'southeast_asia',
  CAS: 'central_asia',
  OC: 'oceania',
} as const satisfies Record<string, WorldRegion>;

// code|region|primary pt name;aliases...
const COUNTRY_TABLE = `
BR|SA|Brasil;Brazil
AR|SA|Argentina;Buenos Aires
CL|SA|Chile;Santiago do Chile
UY|SA|Uruguai;Uruguay;Montevidéu;Montevideo
PY|SA|Paraguai;Paraguay;Assunção
BO|SA|Bolívia;Bolivia
PE|SA|Peru;Perú
EC|SA|Equador;Ecuador;Quito
CO|SA|Colômbia;Colombia;Bogotá
VE|SA|Venezuela;Caracas
GY|SA|Guiana;Guyana
SR|SA|Suriname
MX|NA|México;Mexico
US|NA|Estados Unidos;EUA;United States;USA;U.S.;Washington;Casa Branca;White House;Califórnia;California;Texas;Flórida;Florida;Nova York;New York
CA|NA|Canadá;Canada
CU|CA|Cuba;Havana
HT|CA|Haiti
DO|CA|República Dominicana;Dominican Republic
JM|CA|Jamaica
GT|CA|Guatemala
HN|CA|Honduras
SV|CA|El Salvador
NI|CA|Nicarágua;Nicaragua
CR|CA|Costa Rica
PA|CA|Panamá;Panama
PT|EU|Portugal;Lisboa;Lisbon
ES|EU|Espanha;Spain;España;Madri;Madrid
FR|EU|França;France;Paris
DE|EU|Alemanha;Germany;Berlim;Berlin
IT|EU|Itália;Italy;Rome
GB|EU|Reino Unido;United Kingdom;UK;Inglaterra;England;Grã-Bretanha;Britain;Londres;London;Escócia;Scotland
IE|EU|Irlanda;Ireland
NL|EU|Holanda;Países Baixos;Netherlands;Amsterdã;Amsterdam
BE|EU|Bélgica;Belgium;Bruxelas;Brussels
CH|EU|Suíça;Switzerland;Genebra;Geneva
AT|EU|Áustria;Austria
PL|EU|Polônia;Poland
UA|EU|Ucrânia;Ukraine;Kiev;Kyiv;Kharkiv;Odessa
RU|EU|Rússia;Russia;Moscou;Moscow;Kremlin
BY|EU|Belarus;Bielorrússia
SE|EU|Suécia;Sweden
NO|EU|Noruega;Norway
FI|EU|Finlândia;Finland
DK|EU|Dinamarca;Denmark;Groenlândia;Greenland
GR|EU|Grécia;Greece;Atenas;Athens
RO|EU|Romênia;Romania
HU|EU|Hungria;Hungary
CZ|EU|República Tcheca;Tchéquia;Czech Republic;Czechia
RS|EU|Sérvia;Serbia
HR|EU|Croácia;Croatia
MD|EU|Moldávia;Moldova
TR|ME|Turquia;Türkiye;Ancara;Ankara;Istambul;Istanbul
IL|ME|Israel;Tel Aviv;Jerusalém;Jerusalem
PS|ME|Palestina;Palestine;Gaza;Cisjordânia;West Bank
IR|ME|Irã;Irão;Iran;Teerã;Tehran
IQ|ME|Iraque;Iraq;Bagdá;Baghdad
SY|ME|Síria;Syria;Damasco;Damascus
LB|ME|Líbano;Lebanon;Beirute;Beirut
SA|ME|Arábia Saudita;Saudi Arabia
YE|ME|Iêmen;Yemen
AE|ME|Emirados Árabes Unidos;Emirados Árabes;United Arab Emirates;UAE;Dubai
QA|ME|Catar;Qatar
EG|AF|Egito;Egypt;Cairo
LY|AF|Líbia;Libya
TN|AF|Tunísia;Tunisia
DZ|AF|Argélia;Algeria
MA|AF|Marrocos;Morocco
NG|AF|Nigéria;Nigeria
GH|AF|Gana;Ghana
SN|AF|Senegal
ML|AF|Mali
SD|AF|Sudão;Sudan;Cartum;Khartoum
SS|AF|Sudão do Sul;South Sudan
ET|AF|Etiópia;Ethiopia
SO|AF|Somália;Somalia
KE|AF|Quênia;Kenya;Nairóbi;Nairobi
UG|AF|Uganda
TZ|AF|Tanzânia;Tanzania
CD|AF|República Democrática do Congo;RD Congo;DR Congo
AO|AF|Angola;Luanda
MZ|AF|Moçambique;Mozambique
ZA|AF|África do Sul;South Africa
ZW|AF|Zimbábue;Zimbabwe
CM|AF|Camarões;Cameroon
CV|AF|Cabo Verde;Cape Verde
GW|AF|Guiné-Bissau;Guinea-Bissau
MG|AF|Madagascar
IN|SAS|Índia;India;Nova Délhi;New Delhi;Mumbai
PK|SAS|Paquistão;Pakistan
BD|SAS|Bangladesh
AF|SAS|Afeganistão;Afghanistan;Cabul;Kabul
LK|SAS|Sri Lanka
NP|SAS|Nepal
CN|EAS|China;Pequim;Beijing;Xangai;Shanghai
HK|EAS|Hong Kong
TW|EAS|Taiwan
JP|EAS|Japão;Japan;Tóquio;Tokyo
KR|EAS|Coreia do Sul;South Korea;Seul;Seoul
KP|EAS|Coreia do Norte;North Korea;Pyongyang
MN|EAS|Mongólia;Mongolia
ID|SEA|Indonésia;Indonesia;Jacarta;Jakarta
PH|SEA|Filipinas;Philippines;Manila
VN|SEA|Vietnã;Vietnam
TH|SEA|Tailândia;Thailand;Bangkok
MY|SEA|Malásia;Malaysia
MM|SEA|Mianmar;Myanmar
SG|SEA|Singapura;Singapore
KH|SEA|Camboja;Cambodia
TL|SEA|Timor-Leste;East Timor
KZ|CAS|Cazaquistão;Kazakhstan
UZ|CAS|Uzbequistão;Uzbekistan
AM|CAS|Armênia;Armenia
AZ|CAS|Azerbaijão;Azerbaijan
AU|OC|Austrália;Australia;Sydney;Melbourne
NZ|OC|Nova Zelândia;New Zealand
PG|OC|Papua-Nova Guiné;Papua New Guinea
FJ|OC|Fiji
`;

export interface CountryInfo {
  code: string;
  name: string;
  region: WorldRegion;
  aliases: string[];
}

export const COUNTRIES: CountryInfo[] = COUNTRY_TABLE.trim()
  .split('\n')
  .map((line) => {
    const [code, reg, names] = line.split('|');
    const aliases = names.split(';').map((s) => s.trim());
    return { code, region: R[reg as keyof typeof R], name: aliases[0], aliases };
  });

const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function countryInfo(code?: string): CountryInfo | undefined {
  return code ? COUNTRY_BY_CODE.get(code.toUpperCase()) : undefined;
}

export function regionOfCountry(code?: string): WorldRegion | undefined {
  return countryInfo(code)?.region;
}

// UF|state name|capital|macroregion|lat|lon (capital)
const BR_STATE_TABLE = `
AC|Acre|Rio Branco|Norte|-9.97|-67.81
AL|Alagoas|Maceió|Nordeste|-9.67|-35.74
AP|Amapá|Macapá|Norte|0.03|-51.07
AM|Amazonas|Manaus|Norte|-3.12|-60.02
BA|Bahia|Salvador|Nordeste|-12.97|-38.50
CE|Ceará|Fortaleza|Nordeste|-3.73|-38.53
DF|Distrito Federal|Brasília|Centro-Oeste|-15.79|-47.88
ES|Espírito Santo||Sudeste|-20.32|-40.34
GO|Goiás|Goiânia|Centro-Oeste|-16.68|-49.25
MA|Maranhão|São Luís|Nordeste|-2.53|-44.30
MT|Mato Grosso|Cuiabá|Centro-Oeste|-15.60|-56.10
MS|Mato Grosso do Sul|Campo Grande|Centro-Oeste|-20.47|-54.62
MG|Minas Gerais|Belo Horizonte|Sudeste|-19.92|-43.94
PA|Pará|Belém|Norte|-1.46|-48.49
PB|Paraíba|João Pessoa|Nordeste|-7.12|-34.86
PR|Paraná|Curitiba|Sul|-25.43|-49.27
PE|Pernambuco|Recife|Nordeste|-8.05|-34.88
PI|Piauí|Teresina|Nordeste|-5.09|-42.80
RJ|Rio de Janeiro|Rio de Janeiro|Sudeste|-22.91|-43.17
RN|Rio Grande do Norte||Nordeste|-5.79|-35.21
RS|Rio Grande do Sul|Porto Alegre|Sul|-30.03|-51.23
RO|Rondônia|Porto Velho|Norte|-8.76|-63.90
RR|Roraima|Boa Vista|Norte|2.82|-60.67
SC|Santa Catarina|Florianópolis|Sul|-27.59|-48.55
SP|São Paulo|São Paulo|Sudeste|-23.55|-46.63
SE|Sergipe|Aracaju|Nordeste|-10.91|-37.07
TO|Tocantins||Norte|-10.18|-48.33
`;

export interface BrState {
  uf: string;
  name: string;
  capital: string;
  macro: string;
  lat: number;
  lon: number;
}

export const BR_STATES: BrState[] = BR_STATE_TABLE.trim()
  .split('\n')
  .map((l) => {
    const [uf, name, capital, macro, lat, lon] = l.split('|');
    return { uf, name, capital, macro, lat: Number(lat), lon: Number(lon) };
  });

const BR_STATE_BY_UF = new Map(BR_STATES.map((s) => [s.uf, s]));
const BR_STATE_BY_NAME = new Map(BR_STATES.map((s) => [normalizeForMatch(s.name).trim(), s]));

export function brStateByUf(uf?: string): BrState | undefined {
  return uf ? BR_STATE_BY_UF.get(uf.toUpperCase()) : undefined;
}

/** Map an admin1 name ("Ceará", "Ceara") to its UF when it is a Brazilian state. */
export function brUfFromName(name?: string): string | undefined {
  if (!name) return undefined;
  return BR_STATE_BY_NAME.get(normalizeForMatch(name).trim())?.uf;
}

export function brMacroregionStates(macro: string): string[] {
  return BR_STATES.filter((s) => s.macro === macro).map((s) => s.uf);
}

// Additional Brazilian cities: name|UF|lat|lon
const BR_CITY_TABLE = `
Campinas|SP|-22.91|-47.06
Guarulhos|SP|-23.46|-46.53
São Bernardo do Campo|SP|-23.69|-46.56
Santo André|SP|-23.66|-46.53
Ribeirão Preto|SP|-21.18|-47.81
Sorocaba|SP|-23.50|-47.46
Osasco|SP|-23.53|-46.79
São José dos Campos|SP|-23.18|-45.88
Niterói|RJ|-22.88|-43.10
Duque de Caxias|RJ|-22.79|-43.31
Nova Iguaçu|RJ|-22.76|-43.45
Petrópolis|RJ|-22.51|-43.18
Juiz de Fora|MG|-21.76|-43.35
Uberlândia|MG|-18.92|-48.28
Contagem|MG|-19.93|-44.05
Joinville|SC|-26.30|-48.85
Blumenau|SC|-26.92|-49.07
Londrina|PR|-23.31|-51.16
Maringá|PR|-23.42|-51.94
Foz do Iguaçu|PR|-25.55|-54.59
Caxias do Sul|RS|-29.17|-51.18
Pelotas|RS|-31.77|-52.34
Canoas|RS|-29.92|-51.18
Feira de Santana|BA|-12.27|-38.97
Vitória da Conquista|BA|-14.86|-40.84
Caucaia|CE|-3.74|-38.66
Maracanaú|CE|-3.88|-38.63
Eusébio|CE|-3.89|-38.45
Aquiraz|CE|-3.90|-38.39
Maranguape|CE|-3.89|-38.68
Juazeiro do Norte|CE|-7.21|-39.32
Sobral|CE|-3.69|-40.35
Crato|CE|-7.23|-39.41
Jaboatão dos Guararapes|PE|-8.11|-35.01
Olinda|PE|-8.01|-34.86
Caruaru|PE|-8.28|-35.98
Petrolina|PE|-9.39|-40.50
Mossoró|RN|-5.19|-37.34
Campina Grande|PB|-7.23|-35.88
Aparecida de Goiânia|GO|-16.82|-49.25
Anápolis|GO|-16.33|-48.95
Ananindeua|PA|-1.37|-48.37
Santarém|PA|-2.44|-54.71
Marabá|PA|-5.37|-49.12
Imperatriz|MA|-5.53|-47.48
Vila Velha|ES|-20.33|-40.29
Cariacica|ES|-20.26|-40.42
Parnaíba|PI|-2.90|-41.78
Arapiraca|AL|-9.75|-36.66
Rio Branco|AC|-9.97|-67.81
`;

export interface Place extends GeoRef {
  aliases: string[];
}

function buildPlaces(): Place[] {
  const places: Place[] = [];
  for (const c of COUNTRIES) {
    places.push({
      name: c.name,
      level: 'country',
      countryCode: c.code,
      regions: [c.region],
      confidence: 0.7,
      via: 'text',
      aliases: c.aliases,
    });
  }
  for (const s of BR_STATES) {
    // "estado de X" is unambiguous; the bare state name is also accepted.
    places.push({
      name: s.name,
      level: 'state',
      countryCode: 'BR',
      admin1: s.uf,
      regions: ['south_america'],
      lat: s.lat,
      lon: s.lon,
      confidence: 0.75,
      via: 'text',
      aliases: [s.name, ...(stripAccents(s.name) !== s.name && !['Pará', 'Paraná'].includes(s.name) ? [stripAccents(s.name)] : [])],
    });
    if (s.capital && s.capital !== s.name) {
      places.push({
        name: s.capital,
        level: 'city',
        countryCode: 'BR',
        admin1: s.uf,
        regions: ['south_america'],
        lat: s.lat,
        lon: s.lon,
        confidence: 0.75,
        via: 'text',
        aliases: [s.capital, ...(stripAccents(s.capital) !== s.capital ? [stripAccents(s.capital)] : [])],
      });
    }
  }
  // São Paulo / Rio de Janeiro are both city and state: "capital paulista" etc.
  places.push(
    { name: 'São Paulo (capital)', level: 'city', countryCode: 'BR', admin1: 'SP', regions: ['south_america'], lat: -23.55, lon: -46.63, confidence: 0.8, via: 'text', aliases: ['capital paulista'] },
    { name: 'Rio de Janeiro (capital)', level: 'city', countryCode: 'BR', admin1: 'RJ', regions: ['south_america'], lat: -22.91, lon: -43.17, confidence: 0.8, via: 'text', aliases: ['capital fluminense'] },
    { name: 'Fortaleza', level: 'city', countryCode: 'BR', admin1: 'CE', regions: ['south_america'], lat: -3.73, lon: -38.53, confidence: 0.8, via: 'text', aliases: ['capital cearense'] },
  );
  for (const line of BR_CITY_TABLE.trim().split('\n')) {
    const [name, uf, lat, lon] = line.split('|');
    if (places.some((p) => p.level === 'city' && p.name === name)) continue;
    places.push({
      name,
      level: 'city',
      countryCode: 'BR',
      admin1: uf,
      regions: ['south_america'],
      lat: Number(lat),
      lon: Number(lon),
      confidence: 0.75,
      via: 'text',
      aliases: [name, ...(stripAccents(name) !== name ? [stripAccents(name)] : [])],
    });
  }
  for (const macro of ['Nordeste', 'Norte', 'Sul', 'Sudeste', 'Centro-Oeste']) {
    places.push({
      name: macro,
      level: 'macroregion',
      countryCode: 'BR',
      admin1List: brMacroregionStates(macro),
      regions: ['south_america'],
      confidence: 0.55,
      via: 'text',
      // "Sul"/"Norte" alone are too ambiguous; require "região X".
      aliases: [`região ${macro}`, `Região ${macro}`, `regiao ${stripAccents(macro)}`],
    });
  }
  const regional: [string, WorldRegion[], string[]][] = [
    ['Europa', ['europe'], ['Europa', 'Europe', 'União Europeia', 'European Union', 'UE', 'EU']],
    ['Oriente Médio', ['middle_east'], ['Oriente Médio', 'Middle East']],
    ['América Latina', ['south_america', 'central_america_caribbean'], ['América Latina', 'Latin America', 'América do Sul', 'South America', 'Mercosul', 'Mercosur']],
    ['África', ['africa'], ['África', 'Africa']],
    ['Ásia', ['east_asia', 'southeast_asia', 'south_asia'], ['Ásia', 'Asia']],
    ['Caribe', ['central_america_caribbean'], ['Caribe', 'Caribbean']],
  ];
  for (const [name, regions, aliases] of regional) {
    places.push({ name, level: 'world_region', regions, confidence: 0.5, via: 'text', aliases });
  }
  return places;
}

export const PLACES: Place[] = buildPlaces();

interface Matcher {
  place: Place;
  alias: string;
  re: RegExp;
}

let matchers: Matcher[] | null = null;
function getMatchers(): Matcher[] {
  if (matchers) return matchers;
  const list: Matcher[] = [];
  for (const place of PLACES) {
    for (const alias of place.aliases) {
      list.push({
        place,
        alias,
        re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(alias)}(?![\\p{L}\\p{N}])`, 'gu'),
      });
    }
  }
  // Longest alias first, so "Sudão do Sul" wins over "Sudão", "Rio Grande do Norte" over "Rio Grande".
  list.sort((a, b) => b.alias.length - a.alias.length);
  matchers = list;
  return list;
}

/** Find places mentioned in text. Longest match wins; matched spans are masked. */
export function findPlaces(text: string): GeoRef[] {
  let masked = text.normalize('NFC');
  const found = new Map<string, GeoRef>();
  for (const m of getMatchers()) {
    m.re.lastIndex = 0;
    if (!m.re.test(masked)) continue;
    masked = masked.replace(m.re, (s) => ' '.repeat(s.length));
    const key = `${m.place.level}:${m.place.name}`;
    if (!found.has(key)) {
      const { aliases: _aliases, ...ref } = m.place;
      found.set(key, { ...ref });
    }
  }
  // Pattern "Cidade (UF)" — common in Brazilian outlets.
  const ufRe = /([\p{Lu}][\p{L}' -]{2,40}?)\s*\((AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\)/gu;
  for (const m of text.matchAll(ufRe)) {
    const uf = m[2];
    const city = m[1].trim().split(/\s+(?:em|de|no|na|do|da)\s+/).pop() ?? m[1].trim();
    const st = brStateByUf(uf);
    const key = `city:${city}`;
    if (st && !found.has(key)) {
      found.set(key, {
        name: city,
        level: 'city',
        countryCode: 'BR',
        admin1: uf,
        regions: ['south_america'],
        confidence: 0.8,
        via: 'text-uf',
      });
    }
  }
  return [...found.values()];
}

/** Does `text` mention this specific city name? (Used in the browser for the user's own city.) */
export function mentionsName(text: string, name: string): boolean {
  if (!name || name.length < 3) return false;
  const bounded = (n: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(n)}(?![\\p{L}\\p{N}])`, 'u');
  return bounded(name.normalize('NFC')).test(text.normalize('NFC')) || bounded(stripAccents(name)).test(stripAccents(text));
}
