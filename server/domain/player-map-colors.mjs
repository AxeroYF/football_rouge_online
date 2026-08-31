import { PLAYER_MAP_COLORS } from "../../shared/config/map.mjs";

export function nextAvailablePlayerMapColor(accounts) {
  const values = accounts instanceof Map ? [...accounts.values()] : Object.values(accounts ?? {});
  const used = new Set(values.map((account) => account?.mapColor).filter(Boolean));
  const available = PLAYER_MAP_COLORS.find((color) => !used.has(color));
  if (available) return available;
  const hue = Math.round((values.length * 137.508) % 360);
  return `hsl(${hue} 58% 52%)`;
}
