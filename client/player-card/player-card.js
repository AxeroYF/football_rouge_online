import { installDeferredCardController } from "./deferred-card-controller.js?v=20260906-card-scroll-v1";
import { shieldCardContent } from "./card-shield-markup.js?v=20260905-tactics-cards-v1";
import { installCardMotionController } from "./card-motion-controller.js?v=20260905-shield-v1";
import {
  PLAYER_CARD_VARIANTS,
  createPlayerCardViewModel,
} from "../../shared/player-card/player-card-contract.js";

export function escapePlayerCardHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeVariant(value) {
  return PLAYER_CARD_VARIANTS.includes(value) ? value : "standard";
}

function safeToken(value) {
  return String(value ?? "").replace(/[^a-z0-9_-]/gi, "");
}

function upgradeBand(level) {
  return level >= 8 ? "max" : level >= 5 ? "high" : level >= 1 ? "mid" : "base";
}

/**
 * The only supported renderer for a YellowDogs player card.
 * Business features pass a player/card record plus a controlled variant and action name.
 */
export function playerCardMarkup(player, options = {}) {
  const card = createPlayerCardViewModel(player);
  const deferred = options.deferred === true;
  const variant = safeVariant(options.variant);
  const interactive = options.interactive === true;
  const action = safeToken(options.action);
  const id = safeToken(options.id);
  const art = card.art;
  const classes = [
    "s4-player-card",
    "ydl-player-card",
    `player-card-variant-${variant}`,
    `grade-${safeToken(card.grade.toLowerCase())}`,
    `band-${upgradeBand(card.upgradeLevel)}`,
    art ? "has-player-profile" : "",
    "player-card-shield",
    options.animated === false || deferred ? "player-card-static" : "",
    deferred ? "player-card-deferred" : "",
    options.className ? safeToken(options.className) : "",
  ].filter(Boolean).join(" ");
  const style = art ? ` style="--profile-x:${art.x}%;--profile-y:${art.y}%;--profile-width:${art.width}%"` : "";
  const label = `${card.name}，能力${card.overall ?? "未知"}，${card.role}，${card.grade}级${card.upgradeLevel ? `，强化加${card.upgradeLevel}` : ""}`;
  const attributes = `${id ? ` id="${id}"` : ""} class="${classes}" data-player-card-skin="shield-v1" data-player-card-id="${escapePlayerCardHtml(card.playerId)}"${action ? ` data-player-card-action="${action}"` : ""}${style}`;
  const payload = deferred ? { card: { playerId:card.playerId,cardInstanceId:card.cardInstanceId,name:card.name,sourceName:card.sourceName,overall:card.overall,role:card.role,grade:card.grade,upgradeLevel:card.upgradeLevel,art:card.art,nationality:card.nationality,club:card.club,traits:card.traits }, options:{animated:false} } : null;
  const lazyAttribute = payload ? ` data-card-render="${escapePlayerCardHtml(JSON.stringify(payload))}"` : "";
  const content = deferred ? '<span class="shield-card-surface"></span>' : shieldCardContent(card, options, escapePlayerCardHtml, safeToken);
  if (interactive) return `<button type="button"${attributes}${lazyAttribute} aria-label="${escapePlayerCardHtml(options.ariaPrefix ?? "查看")}${escapePlayerCardHtml(label)}"${action ? ' aria-haspopup="dialog"' : ""}>${content}</button>`;
  return `<div${attributes}${lazyAttribute} role="img" aria-label="${escapePlayerCardHtml(label)}">${content}</div>`;
}

installCardMotionController();
export function renderDeferredCardContent({ card, options }) {
  const markup = shieldCardContent(card, options, escapePlayerCardHtml, safeToken);
  return markup.slice(markup.indexOf(">") + 1, -7);
}
installDeferredCardController(renderDeferredCardContent);

export { createPlayerCardViewModel };
