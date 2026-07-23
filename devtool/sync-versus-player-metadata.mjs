import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const outputPath = process.argv.find((value) => value.startsWith("--output="))?.slice(9);
const cachePath = outputPath ? `${outputPath}.search-cache.json` : null;
const searchOnly = process.argv.includes("--search-only");
const source = await readFile(path.join(projectRoot, "versus/player-pool.js"), "utf8");
const oldPlayers = [];
for (const match of source.matchAll(/\b(GK|DEF|MID|ATT): `\r?\n([\s\S]*?)`,/g)) {
  match[2].trim().split(/\r?\n/).slice(0, 100).forEach((line) => {
    const [name, role] = line.split("|");
    oldPlayers.push({ name, role, pool:match[1] });
  });
}

const api = "https://www.wikidata.org/w/api.php";
const headers = { "user-agent":"football-versus-metadata-sync/1.0 (local development)" };
async function wikidata(parameters) {
  const url = `${api}?${new URLSearchParams({ format:"json", origin:"*", ...parameters })}`;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 140 + Math.floor(Math.random() * 90)));
    const response = await fetch(url, { headers });
    if (response.ok) return response.json();
    if (response.status !== 429 || attempt === 6) throw new Error(`Wikidata ${response.status}: ${url}`);
    const retryAfter = Number(response.headers.get("retry-after") ?? 0);
    await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter * 1000, attempt * 2500)));
  }
  throw new Error(`Wikidata request failed: ${url}`);
}

function isFootballResult(entry) {
  return /football|soccer|足球|守门员|門將/i.test(`${entry.description ?? ""} ${entry.label ?? ""}`);
}

async function searchPlayer(player) {
  const result = await wikidata({ action:"wbsearchentities", search:player.name, language:"zh", uselang:"zh", limit:"8" });
  const candidates = result.search ?? [];
  const exact = candidates.find((entry) => isFootballResult(entry) && (entry.match?.text === player.name || entry.label === player.name));
  const football = exact ?? candidates.find(isFootballResult);
  return { ...player, wikidataId:football?.id ?? null, matchedLabel:football?.label ?? null, description:football?.description ?? null };
}

async function concurrentMap(values, concurrency, worker) {
  const output = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length:concurrency }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      try { output[index] = await worker(values[index], index); }
      catch (error) { output[index] = { ...values[index], wikidataId:null, error:error.message }; }
    }
  }));
  return output;
}

let searched;
if (cachePath) {
  try { searched = JSON.parse(await readFile(cachePath, "utf8")); }
  catch { /* 首次同步没有缓存 */ }
}
if (!Array.isArray(searched) || searched.length !== oldPlayers.length) searched = new Array(oldPlayers.length).fill(null);
let searchedNow = false;
for (let start = 0; start < oldPlayers.length; start += 12) {
  const indexes = Array.from({ length:Math.min(12, oldPlayers.length - start) }, (_, offset) => start + offset).filter((index) => !searched[index]);
  if (!indexes.length) continue;
  const batch = await Promise.all(indexes.map((index) => searchPlayer(oldPlayers[index]).catch((error) => ({ ...oldPlayers[index], wikidataId:null, error:error.message }))));
  indexes.forEach((index, offset) => { searched[index] = batch[offset]; });
  searchedNow = true;
  if (cachePath) await writeFile(cachePath, `${JSON.stringify(searched, null, 2)}\n`, "utf8");
}
if (searchOnly) {
  const summary = { players:searched.length, searched:searched.filter(Boolean).length, matched:searched.filter((entry) => entry?.wikidataId).length };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exit(0);
}
if (searchedNow) await new Promise((resolve) => setTimeout(resolve, 30_000));
const ids = [...new Set(searched.map((entry) => entry.wikidataId).filter(Boolean))];
async function getEntities(entityIds, props = "claims|labels|descriptions") {
  const entities = {};
  for (let index = 0; index < entityIds.length; index += 50) {
    const result = await wikidata({ action:"wbgetentities", ids:entityIds.slice(index, index + 50).join("|"), props, languages:"zh|en", languagefallback:"1" });
    Object.assign(entities, result.entities ?? {});
  }
  return entities;
}

const people = await getEntities(ids);
const linkedIds = new Set();
for (const person of Object.values(people)) {
  for (const property of ["P27", "P54"]) for (const claim of person.claims?.[property] ?? []) {
    const id = claim.mainsnak?.datavalue?.value?.id;
    if (id) linkedIds.add(id);
  }
}
const linked = await getEntities([...linkedIds], "labels|descriptions");

const label = (entity) => entity?.labels?.zh?.value ?? entity?.labels?.en?.value ?? null;
const description = (entity) => entity?.descriptions?.zh?.value ?? entity?.descriptions?.en?.value ?? "";
const timeYear = (snak) => {
  const time = snak?.[0]?.datavalue?.value?.time;
  const match = String(time ?? "").match(/[+-](\d{4,})-/);
  return match ? Number(match[1]) : null;
};
const isNationalTeam = (entity) => /national.*team|国家.*队|國家.*隊/i.test(`${label(entity) ?? ""} ${description(entity)}`);

const currentYear = new Date().getUTCFullYear();
const metadata = searched.map((search) => {
  const person = people[search.wikidataId];
  if (!person) return { ...search, nationality:null, club:null, status:"unmatched", source:null };
  const personDescription = `${search.description ?? ""} ${description(person)}`;
  const careerEnd = timeYear(person.claims?.P2031?.[0]?.qualifiers?.P582) ?? timeYear(person.claims?.P2031?.[0]?.mainsnak ? [person.claims.P2031[0].mainsnak] : null);
  const retired = Boolean(person.claims?.P570?.length) || /former|retired|退役|前足球/i.test(personDescription) || (careerEnd && careerEnd < currentYear);
  const nationalities = [...new Set((person.claims?.P27 ?? []).map((claim) => label(linked[claim.mainsnak?.datavalue?.value?.id])).filter(Boolean))];
  const clubs = (person.claims?.P54 ?? []).map((claim) => {
    const entity = linked[claim.mainsnak?.datavalue?.value?.id];
    const start = timeYear(claim.qualifiers?.P580);
    const end = timeYear(claim.qualifiers?.P582);
    return { name:label(entity), start, end, rank:claim.rank, national:isNationalTeam(entity) };
  }).filter((club) => club.name && !club.national);
  const open = clubs.filter((club) => !club.end).sort((left, right) => (right.rank === "preferred") - (left.rank === "preferred") || (right.start ?? 0) - (left.start ?? 0));
  const longest = [...clubs].sort((left, right) => {
    const leftDuration = left.start ? (left.end ?? careerEnd ?? currentYear) - left.start : 0;
    const rightDuration = right.start ? (right.end ?? careerEnd ?? currentYear) - right.start : 0;
    return rightDuration - leftDuration || (right.end ?? currentYear) - (left.end ?? currentYear);
  });
  const selectedClub = retired ? longest[0] : open[0] ?? longest[0];
  return {
    name:search.name, role:search.role, pool:search.pool,
    nationality:nationalities[0] ?? null,
    club:selectedClub?.name ?? null,
    status:retired ? "retired" : "active",
    wikidataId:search.wikidataId,
    matchedLabel:search.matchedLabel,
    source:`https://www.wikidata.org/wiki/${search.wikidataId}`,
    confidence:search.matchedLabel === search.name ? "high" : "review",
  };
});

const result = {
  generatedAt:new Date().toISOString(), source:"Wikidata", policy:"active=current club; retired=longest recorded club tenure",
  totals:{ players:metadata.length, matched:metadata.filter((entry) => entry.nationality && entry.club).length, review:metadata.filter((entry) => entry.confidence === "review").length },
  players:metadata,
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) await writeFile(outputPath, serialized, "utf8");
else process.stdout.write(serialized);
