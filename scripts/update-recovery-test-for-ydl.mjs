import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "test/player-library-recovery.test.js");
const before = '    assert.equal(JSON.parse(fs.readFileSync(path.join(value.root, "data/player-library-admin.json"))).batches.batch1.status, "published");';
const after = '    const admin = JSON.parse(fs.readFileSync(path.join(value.root, "data/player-library-admin.json")));\n    assert.equal(admin.librarySource, "YDL");\n    assert.deepEqual(admin.batches, {});\n    assert.equal(catalog.find((entry) => entry.id === "p2").librarySource, "YDL");';
const source = fs.readFileSync(file, "utf8");
if (!source.includes(after)) {
  if (!source.includes(before)) throw new Error("找不到需要更新的旧批次断言");
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, source.replace(before, after));
  fs.renameSync(temporary, file);
}
