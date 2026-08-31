export function createCampaignStore(initialState = null) {
  let state = initialState;
  let version = 0;
  const listeners = new Set();

  return {
    getState: () => state,
    getVersion: () => version,
    setState(nextState, { source = "unknown" } = {}) {
      if (nextState === state) return state;
      const previousState = state;
      state = nextState;
      version += 1;
      const change = Object.freeze({ state, previousState, source, version });
      for (const listener of [...listeners]) listener(change);
      return state;
    },
    subscribe(listener, { emitCurrent = false } = {}) {
      if (typeof listener !== "function") throw new Error("Campaign store listener must be a function");
      listeners.add(listener);
      if (emitCurrent) {
        listener(Object.freeze({ state, previousState: state, source: "subscribe", version }));
      }
      return () => listeners.delete(listener);
    },
  };
}
