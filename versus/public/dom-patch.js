// Keep delegated page controls, card images and scrolling containers attached while
// applying the same HTML the existing renderers produce. No layout or data policy
// belongs here. Pages with directly bound drag handlers use their existing renderer.
const keyedAttributes = [
  "id", "data-render-key", "data-enhancement-card", "data-enhancement-card-id",
  "data-enhancement-result-card", "data-s4-card-detail", "data-watch-room",
  "data-broadcast-player", "data-event-id",
];

function nodeKey(node) {
  if (node.nodeType !== 1) return null;
  for (const name of keyedAttributes) {
    if (node.hasAttribute(name)) return `${name}:${node.getAttribute(name)}`;
  }
  return null;
}

function compatible(current, next) {
  return current.nodeType === next.nodeType && current.nodeName === next.nodeName
    && current.namespaceURI === next.namespaceURI;
}

function syncControl(current, next) {
  if (current.tagName === "INPUT") {
    if (current.checked !== next.checked) current.checked = next.checked;
    if (current.value !== next.value && current.type !== "file") current.value = next.value;
  } else if (current.tagName === "TEXTAREA") {
    if (current.value !== next.value) current.value = next.value;
  } else if (current.tagName === "OPTION") {
    if (current.selected !== next.selected) current.selected = next.selected;
  }
}

function patchNode(current, next) {
  if (current.nodeType !== 1) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  // isEqualNode uses the browser's native comparison and avoids walking every
  // descendant of unchanged player cards in JavaScript.
  if (current.isEqualNode(next) && !current.matches("input, textarea, option, select")
      && !current.querySelector("input, textarea, select")) return;
  for (const {name} of [...current.attributes]) {
    if (!next.hasAttribute(name)) current.removeAttribute(name);
  }
  for (const {name, value} of next.attributes) {
    if (current.getAttribute(name) !== value) current.setAttribute(name, value);
  }
  // Read form properties before moving the template's children.
  const selected = current.tagName === "SELECT" ? [...next.options].map(option => option.selected) : null;
  syncControl(current, next);
  patchChildren(current, next);
  if (selected) [...current.options].forEach((option, index) => {
    if (option.selected !== selected[index]) option.selected = selected[index];
  });
}

function patchChildren(current, next) {
  const desiredNodes = [...next.childNodes];
  const nextKeys = new Set(desiredNodes.map(nodeKey).filter(key => key !== null));
  const keyed = new Map();
  for (const node of [...current.childNodes]) {
    const key = nodeKey(node);
    if (key !== null && !nextKeys.has(key)) node.remove();
    else if (key !== null && !keyed.has(key)) keyed.set(key, node);
  }
  const used = new Set();
  let cursor = current.firstChild;
  for (const desired of desiredNodes) {
    const key = nodeKey(desired);
    const candidate = key !== null ? keyed.get(key) : (nodeKey(cursor ?? {}) === null ? cursor : null);
    if (candidate && !used.has(candidate) && compatible(candidate, desired)) {
      if (candidate !== cursor) current.insertBefore(candidate, cursor);
      patchNode(candidate, desired);
      used.add(candidate);
      cursor = candidate.nextSibling;
    } else {
      current.insertBefore(desired, cursor);
    }
  }
  while (cursor) {
    const nextSibling = cursor.nextSibling;
    current.removeChild(cursor);
    cursor = nextSibling;
  }
}

export function patchHtmlChildren(current, html) {
  const template = current.ownerDocument.createElement("template");
  template.innerHTML = html;
  patchChildren(current, template.content);
}

export function htmlChildrenMatch(current, html) {
  const template = current.ownerDocument.createElement("template");
  template.innerHTML = html;
  if (current.childNodes.length !== template.content.childNodes.length
      || ![...current.childNodes].every((node, index) => node.isEqualNode(template.content.childNodes[index]))) return false;
  const controls = [...current.querySelectorAll("input, textarea, select")];
  const desired = [...template.content.querySelectorAll("input, textarea, select")];
  return controls.every((control, index) => control.value === desired[index].value
    && control.checked === desired[index].checked
    && (control.tagName !== "SELECT" || !control.multiple
      || [...control.options].every((option, optionIndex) => option.selected === desired[index].options[optionIndex].selected)));
}

export function patchHtmlElement(current, html) {
  const template = current.ownerDocument.createElement("template");
  template.innerHTML = html.trim();
  const next = template.content.firstElementChild;
  if (!next) return;
  patchDomElement(current, next);
}

export function patchDomElement(current, next) {
  if (compatible(current, next)) patchNode(current, next);
  else current.replaceWith(next);
}
