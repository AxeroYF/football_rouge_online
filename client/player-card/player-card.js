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

function cardContent(card, { imageId = "", showArtPlaceholder = false } = {}) {
  const art = card.art;
  const artMarkup = art
    ? `<img ${imageId ? `id="${safeToken(imageId)}" ` : ""}class="s4-player-card-profile" data-player-card-art src="${escapePlayerCardHtml(art.url)}" alt="" loading="lazy" decoding="async" draggable="false">`
    : showArtPlaceholder ? '<div class="player-card-art-placeholder" data-player-card-art-placeholder>上传透明球员卡画</div>' : "";
  const overall = card.overall ?? "—";
  const traits = card.traits.length ? `<span class="team-card-traits">${escapePlayerCardHtml(card.traits.join(" · "))}</span>` : "";
  return `${artMarkup}<div class="s4-player-card-head"><strong>${escapePlayerCardHtml(overall)}</strong><b>${escapePlayerCardHtml(card.role)}</b></div><div class="s4-player-card-grade"><span>${escapePlayerCardHtml(card.grade)}</span></div><div class="s4-player-card-name"><h3>${escapePlayerCardHtml(card.name)}</h3></div><footer><b>${escapePlayerCardHtml(card.club)} / ${escapePlayerCardHtml(card.nationality)}</b>${traits}</footer>`;
}

/**
 * The only supported renderer for a YellowDogs player card.
 * Business features pass a player/card record plus a controlled variant and action name.
 */
export function playerCardMarkup(player, options = {}) {
  const card = createPlayerCardViewModel(player);
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
    "band-base",
    art ? "has-player-profile" : "",
    options.className ? safeToken(options.className) : "",
  ].filter(Boolean).join(" ");
  const style = art ? ` style="--profile-x:${art.x}%;--profile-y:${art.y}%;--profile-width:${art.width}%"` : "";
  const label = `${card.name}，能力${card.overall ?? "未知"}，${card.role}，${card.grade}级`;
  const attributes = `${id ? ` id="${id}"` : ""} class="${classes}" data-player-card-id="${escapePlayerCardHtml(card.playerId)}"${action ? ` data-player-card-action="${action}"` : ""}${style}`;
  const content = cardContent(card, options);
  if (interactive) return `<button type="button"${attributes} aria-label="${escapePlayerCardHtml(options.ariaPrefix ?? "查看")}${escapePlayerCardHtml(label)}"${action ? ' aria-haspopup="dialog"' : ""}>${content}</button>`;
  return `<div${attributes} role="img" aria-label="${escapePlayerCardHtml(label)}">${content}</div>`;
}

export { createPlayerCardViewModel };
