// Use this component for every player-facing gold amount. Currency names in
// prose, errors and accessible labels stay readable as text.
const goldFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 });
const goldIconUrl = new URL("../../assets/ui/gold-coin.svg", import.meta.url).href;

export function goldIconMarkup() {
  return `<img class="gold-icon" src="${goldIconUrl}" width="24" height="24" alt="" aria-hidden="true" draggable="false">`;
}

export function goldAmountMarkup(value, { signed = false } = {}) {
  const amount = Number(value);
  const text = Number.isFinite(amount)
    ? `${signed && amount > 0 ? "+" : ""}${goldFormatter.format(amount)}`
    : "—";
  return `<span class="gold-amount" role="img" aria-label="${text} 金币">${goldIconMarkup()}<span class="gold-amount-value" aria-hidden="true">${text}</span></span>`;
}
