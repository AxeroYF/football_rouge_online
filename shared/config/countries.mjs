export const CORE_COUNTRY_CODES = Object.freeze(["GBR", "ESP", "DEU", "ITA", "FRA", "PRT", "NLD", "BRA", "ARG"]);

const NATIONALITIES = {
  GBR: ["英国", "英格兰", "苏格兰", "威尔士", "北爱尔兰", "England", "Scotland", "Wales", "Northern Ireland", "United Kingdom", "GBR", "ENG", "SCO", "WAL", "NIR"],
  ESP: ["西班牙", "Spain", "ESP"], DEU: ["德国", "Germany", "DEU", "GER"],
  ITA: ["意大利", "Italy", "ITA"], FRA: ["法国", "France", "FRA"],
  PRT: ["葡萄牙", "Portugal", "PRT", "POR"], NLD: ["荷兰", "Netherlands", "NLD", "NED"],
  BRA: ["巴西", "Brazil", "BRA"], ARG: ["阿根廷", "Argentina", "ARG"],
};

export function coreCountryName(code) { return NATIONALITIES[code]?.[0] ?? null; }

export function coreCountryForNationality(value) {
  const nationality = String(value ?? "").trim().toLowerCase();
  return CORE_COUNTRY_CODES.find((code) => NATIONALITIES[code].some((name) => name.toLowerCase() === nationality)) ?? null;
}
