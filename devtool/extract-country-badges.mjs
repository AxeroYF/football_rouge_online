import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const sourcePath = process.argv[2];
const outputDirectory = process.argv[3];
if (!sourcePath || !outputDirectory) throw new Error("Usage: node devtool/extract-country-badges.mjs <source.png> <output-directory>");

const cells = [
  ["qatar", 20, 20, 205, 205], ["ecuador", 225, 20, 205, 205], ["senegal", 430, 20, 205, 205], ["netherlands", 635, 20, 205, 205], ["england", 840, 20, 205, 205], ["iran", 1045, 20, 205, 205], ["usa", 1250, 20, 205, 205],
  ["wales", 20, 225, 205, 200], ["argentina", 225, 225, 205, 200], ["saudi-arabia", 430, 225, 205, 200], ["mexico", 635, 225, 205, 200], ["poland", 840, 225, 205, 200], ["france", 1045, 225, 205, 200], ["australia", 1250, 225, 205, 200],
  ["denmark", 20, 425, 205, 205], ["tunisia", 225, 425, 205, 205], ["spain", 430, 425, 205, 205], ["costa-rica", 635, 425, 205, 205], ["germany", 840, 425, 205, 205], ["japan", 1045, 425, 205, 205], ["belgium", 1250, 425, 205, 205],
  ["canada", 20, 630, 205, 205], ["morocco", 225, 630, 205, 205], ["croatia", 430, 630, 205, 205], ["brazil", 635, 630, 205, 205], ["serbia", 840, 630, 205, 205], ["switzerland", 1045, 630, 205, 205], ["cameroon", 1250, 630, 205, 205],
  ["portugal", 122, 835, 205, 205], ["ghana", 327, 835, 205, 205], ["uruguay", 532, 835, 205, 205], ["south-korea", 737, 835, 205, 205], ["china", 942, 835, 205, 205], ["italy", 1147, 835, 205, 205],
];

function transparentConnectedBackground(data, width, height) {
  const pixels = Buffer.from(data);
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const backgroundLike = (index) => {
    const offset = index * 4;
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    // The source sheet has a white background plus a neutral gray drop shadow.
    // Flooding all border-connected neutral pixels removes that baked shadow and
    // its white fringe while enclosed white/silver areas inside a shield remain
    // protected by the colored outer rim.
    return Math.min(r, g, b) >= 70 && Math.max(r, g, b) - Math.min(r, g, b) <= 32;
  };
  const add = (index) => {
    if (visited[index] || !backgroundLike(index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) { add(x); add((height - 1) * width + x); }
  for (let y = 0; y < height; y += 1) { add(y * width); add(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) add(index - 1);
    if (x + 1 < width) add(index + 1);
    if (y > 0) add(index - width);
    if (y + 1 < height) add(index + width);
  }
  for (let index = 0; index < visited.length; index += 1) {
    if (visited[index]) pixels[index * 4 + 3] = 0;
  }
  return pixels;
}

function keepLargestOpaqueComponent(pixels, width, height) {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let largest = [];
  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start] || pixels[start * 4 + 3] === 0) continue;
    let head = 0;
    let tail = 0;
    const component = [];
    visited[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const index = queue[head++];
      component.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (visited[next] || pixels[next * 4 + 3] === 0) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (component.length > largest.length) largest = component;
  }
  const retained = new Uint8Array(width * height);
  largest.forEach((index) => { retained[index] = 1; });
  for (let index = 0; index < retained.length; index += 1) {
    if (!retained[index]) pixels[index * 4 + 3] = 0;
  }
  return pixels;
}

function extendEdgeColors(pixels, width, height, radius = 3) {
  const distance = new Int16Array(width * height);
  distance.fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let index = 0; index < distance.length; index += 1) {
    if (pixels[index * 4 + 3] > 0) {
      distance[index] = 0;
      queue[tail++] = index;
    }
  }
  while (head < tail) {
    const index = queue[head++];
    if (distance[index] >= radius) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    for (const next of [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y > 0 ? index - width : -1, y + 1 < height ? index + width : -1]) {
      if (next < 0 || distance[next] >= 0) continue;
      distance[next] = distance[index] + 1;
      const sourceOffset = index * 4;
      const targetOffset = next * 4;
      pixels[targetOffset] = pixels[sourceOffset];
      pixels[targetOffset + 1] = pixels[sourceOffset + 1];
      pixels[targetOffset + 2] = pixels[sourceOffset + 2];
      queue[tail++] = next;
    }
  }
  return pixels;
}

async function smoothAlpha(pixels, width, height) {
  const alpha = await sharp(pixels, { raw:{ width, height, channels:4 } })
    .extractChannel(3)
    .blur(0.85)
    .linear(1.18, -23)
    .raw()
    .toBuffer();
  for (let index = 0; index < alpha.length; index += 1) pixels[index * 4 + 3] = alpha[index];
  return pixels;
}

await mkdir(outputDirectory, { recursive:true });
for (const [id, left, top, width, height] of cells) {
  const { data, info } = await sharp(sourcePath)
    .extract({ left, top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject:true });
  const transparent = await smoothAlpha(extendEdgeColors(keepLargestOpaqueComponent(transparentConnectedBackground(data, info.width, info.height), info.width, info.height), info.width, info.height), info.width, info.height);
  await sharp(transparent, { raw:info })
    .trim({ background:{ r:0, g:0, b:0, alpha:0 }, threshold:2 })
    .extend({ top:6, bottom:6, left:6, right:6, background:{ r:0, g:0, b:0, alpha:0 } })
    // Keep a 2x UI master. Lanczos resampling turns the source mask into a
    // subpixel antialiased edge; 500 + 12px transparent padding = 512px.
    .resize({ height:500, fit:"inside", withoutEnlargement:false, kernel:sharp.kernel.lanczos3 })
    .webp({ lossless:true, effort:6 })
    .toFile(path.join(outputDirectory, `${id}.webp`));
}

console.log(`Extracted ${cells.length} country badges to ${outputDirectory}`);
