export const SAVE_STORE_VERSION = 1;

export function createSaveId(now = Date.now(), random = Math.random) {
  return `save-${Number(now).toString(36)}-${Math.floor(random() * 0x1000000).toString(36).padStart(5, "0")}`;
}

export function emptySaveStore() {
  return { version: SAVE_STORE_VERSION, activeSaveId: null, saves: [] };
}

export function normalizeSaveStore(value) {
  const source = value && typeof value === "object" ? value : emptySaveStore();
  const seen = new Set();
  const saves = (Array.isArray(source.saves) ? source.saves : [])
    .filter((entry) => entry?.run && typeof entry.run === "object")
    .map((entry) => {
      const id = String(entry.id || entry.run.saveId || createSaveId());
      if (seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        updatedAt: entry.updatedAt || entry.run.updatedAt || entry.run.createdAt || new Date(0).toISOString(),
        run: { ...entry.run, saveId: id },
      };
    })
    .filter(Boolean)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  const activeSaveId = saves.some((entry) => entry.id === source.activeSaveId)
    ? source.activeSaveId
    : saves[0]?.id ?? null;
  return { version: SAVE_STORE_VERSION, activeSaveId, saves };
}

export function upsertRunSave(value, run, updatedAt = new Date().toISOString()) {
  const store = normalizeSaveStore(value);
  const id = String(run.saveId || createSaveId());
  const entry = { id, updatedAt, run: { ...run, saveId: id, updatedAt } };
  return normalizeSaveStore({
    version: SAVE_STORE_VERSION,
    activeSaveId: id,
    saves: [entry, ...store.saves.filter((item) => item.id !== id)],
  });
}

export function removeRunSave(value, saveId) {
  const store = normalizeSaveStore(value);
  const saves = store.saves.filter((entry) => entry.id !== saveId);
  return normalizeSaveStore({
    version: SAVE_STORE_VERSION,
    activeSaveId: store.activeSaveId === saveId ? saves[0]?.id ?? null : store.activeSaveId,
    saves,
  });
}
