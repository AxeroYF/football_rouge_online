import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = path.join(root, 'assets/data/s4-player-profile-registry.json');
const catalogs = [
  path.join(root, 'assets/data/s4-player-base-catalog.json'),
  path.join(root, 'assets/data/s4-player-catalog.json'),
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function syncPlayerProfiles({ rootDir = root } = {}) {
  const registryFile = path.join(rootDir, 'assets/data/s4-player-profile-registry.json');
  const registry = readJson(registryFile);
  const profiles = registry.profiles ?? {};
  const missing = [];
  let updated = 0;
  for (const catalogFile of catalogs.map((file) => path.join(rootDir, path.relative(root, file)))) {
    const catalog = readJson(catalogFile);
    const players = Array.isArray(catalog) ? catalog : (catalog.players ?? []);
    for (const player of players) {
      const profile = profiles[String(player.id)];
      if (!profile) continue;
      const asset = path.join(rootDir, 'assets/player-profiles', profile.fileName);
      if (!fs.existsSync(asset)) {
        missing.push(`${player.id}:${profile.fileName}`);
        continue;
      }
      player.portrait = `./assets/player-profiles/${profile.fileName}`;
      player.portraitPosition = { x: profile.x, y: profile.y, width: profile.width };
      updated += 1;
    }
    writeJson(catalogFile, catalog);
  }
  if (missing.length) throw new Error(`Missing player profile assets: ${missing.join(', ')}`);
  return { registryEntries: Object.keys(profiles).length, updated };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = syncPlayerProfiles();
  console.log(`Synchronized ${result.updated} catalog profile references from ${result.registryEntries} registry entries.`);
}

