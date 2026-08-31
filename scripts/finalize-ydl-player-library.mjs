import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeYdlPlayerLibrary } from "./normalize-ydl-player-library.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function writeAtomic(file, text) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
}
function update(relative, transform) {
  const file = path.join(root, relative);
  const before = fs.readFileSync(file, "utf8");
  const after = transform(before);
  writeAtomic(file, after);
}
function replace(text, pattern, replacement, donePattern, label) {
  if (donePattern.test(text)) return text;
  const updated = text.replace(pattern, replacement);
  if (updated === text) throw new Error(`无法定位需要更新的代码：${label}`);
  return updated;
}

normalizeYdlPlayerLibrary({ root, updateSources:false });

update("server/application/player-library-service.mjs", (source) => {
  let text = replace(
    source,
    /attributes: clone\(player\.attributes \?\? \{\}\), status, batchId: player\.batchId \?\? null,/,
    'attributes: clone(player.attributes ?? {}), status, batchId: player.batchId ?? null, librarySource: player.librarySource ?? "YDL",',
    /batchId: player\.batchId \?\? null, librarySource: player\.librarySource \?\? "YDL"/,
    "公开球员来源",
  );
  text = replace(
    text,
    /return \{\r?\n\s+name: clean\(input\.name \?\? current\.name\), sourceName:/,
    'return {\n      librarySource: "YDL", name: clean(input.name ?? current.name), sourceName:',
    /librarySource: "YDL", name: clean\(input\.name \?\? current\.name\)/,
    "维护球员来源",
  );
  return replace(text, /sourceGroup: "admin", updatedAt:/, 'sourceGroup: "YDL", updatedAt:', /sourceGroup: "YDL", updatedAt:/, "后台卡画来源");
});

update("scripts/import-s4-player-profiles.mjs", (source) => replace(
  source, /sourceGroup: group \};/, 'sourceGroup: "YDL" };', /sourceGroup: "YDL" \};/, "静态卡画来源",
));

update("scripts/recover-s4-player-library.mjs", (source) => {
  let text = replace(source, /isX: false, requestedOverall:/, 'isX: false, librarySource: "YDL", requestedOverall:', /isX: false, librarySource: "YDL", requestedOverall:/, "恢复球员来源");
  text = text.replace(/attributeMode: record\.attributeMode \?\? null, batchId: record\.batchId \?\? null,/, "attributeMode: record.attributeMode ?? null,");
  text = replace(text, /sourceGroup: "s4-studio", updatedAt:/, 'sourceGroup: "YDL", updatedAt:', /sourceGroup: "YDL", updatedAt:/, "恢复卡画来源");
  if (!/admin\.librarySource = "YDL";/.test(text)) {
    text = text.replace(
      /  for \(const \[id, batch\] of Object\.entries\(studio\.batches \?\? \{\}\)\) admin\.batches\[id\] = clone\(batch\);\r?\n  admin\.updatedAt = now;\r?\n  admin\.recovery = \{[\s\S]*?\r?\n  \};/,
      '  admin.librarySource = "YDL";\n  admin.updatedAt = now;',
    );
    if (!/admin\.librarySource = "YDL";/.test(text)) throw new Error("无法定位需要更新的代码：恢复后台历史批次");
  }
  return text;
});

console.log(JSON.stringify({ players:842, playerSource:"YDL", profileSource:"YDL", historicalBatches:0, stableIds:true }, null, 2));
