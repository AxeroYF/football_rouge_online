function meteorMarkup() {
  return Array.from({ length:16 },(_,index) => {
    const startX = (index * 47) % 142 - 21;
    const startY = (index * 31) % 136 - 52;
    const delay = -((index * 37) % 120) / 10;
    const duration = 2.5 + (index % 7) * .3;
    const length = 62 + (index % 6) * 22;
    const opacity = .38 + index % 5 * .12;
    return `<i style="--meteor-x:${startX}vw;--meteor-y:${startY}vh;--meteor-delay:${delay}s;--meteor-duration:${duration}s;--meteor-length:${length}px;--meteor-opacity:${opacity}"></i>`;
  }).join("");
}

export function meteorLayer() {
  return `<div class="inventory-opening-meteors" aria-hidden="true">${meteorMarkup()}</div>`;
}

