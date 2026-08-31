export function hashSeed(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class Random {
  constructor(seed = Date.now()) {
    this.state = hashSeed(seed) || 0x6d2b79f5;
    this.spareNormal = null;
  }

  next() {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  bool(probability) {
    return this.next() < probability;
  }

  range(minimum, maximum) {
    return minimum + (maximum - minimum) * this.next();
  }

  normal(mean = 0, standardDeviation = 1) {
    if (this.spareNormal !== null) {
      const value = this.spareNormal;
      this.spareNormal = null;
      return mean + value * standardDeviation;
    }

    let first = 0;
    let second = 0;
    while (first === 0) first = this.next();
    while (second === 0) second = this.next();
    const magnitude = Math.sqrt(-2 * Math.log(first));
    const angle = 2 * Math.PI * second;
    this.spareNormal = magnitude * Math.sin(angle);
    return mean + magnitude * Math.cos(angle) * standardDeviation;
  }

  weighted(items, weightFor) {
    if (items.length === 0) return undefined;
    const weights = items.map((item) => Math.max(0, weightFor(item)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) return items[Math.floor(this.next() * items.length)];

    let cursor = this.next() * total;
    for (let index = 0; index < items.length; index += 1) {
      cursor -= weights[index];
      if (cursor <= 0) return items[index];
    }
    return items.at(-1);
  }
}
