// Keep each player's latest edit independently; one request per player at a time.
export function createStudioAutosave({ save, onSaved = () => {}, onChange = () => {}, delay = 600 }) {
  const entries = new Map();
  function notify() { onChange(entries); }
  async function flush(id) {
    const entry = entries.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = null;
    if (entry.running || !entry.dirty) return;
    const snapshot = { ...entry.value, position: { ...entry.value.position } };
    const version = entry.version;
    entry.running = true;
    entry.status = "saving";
    notify();
    try {
      const result = await save(id, snapshot);
      // A queued edit using the same file now only needs a position save.
      if (entry.value.file === snapshot.file) entry.value.file = null;
      entry.dirty = entry.version !== version;
      entry.status = entry.dirty ? "pending" : "saved";
      entry.error = null;
      onSaved(id, result, snapshot, !entry.dirty);
    } catch (error) {
      entry.status = "error";
      entry.error = error.message;
    } finally {
      entry.running = false;
      notify();
      if (entry.dirty && entry.status !== "error" && !entry.timer) void flush(id);
    }
  }
  return {
    entries,
    get: (id) => entries.get(id),
    change(id, value) {
      let entry = entries.get(id);
      if (!entry) { entry = { version: 0 }; entries.set(id, entry); }
      clearTimeout(entry.timer);
      entry.value = { ...value, position: { ...value.position } };
      entry.version++;
      entry.dirty = true;
      entry.status = "pending";
      entry.timer = setTimeout(() => { entry.timer = null; void flush(id); }, delay);
      notify();
    },
    flush,
    retry() { for (const [id, entry] of entries) if (entry.dirty) void flush(id); },
    unsettled() { return [...entries.values()].some((entry) => entry.dirty || entry.running); },
  };
}
