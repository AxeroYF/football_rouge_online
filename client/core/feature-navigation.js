// Navigation identity is independent of display order and hidden menu entries.
export function createFeatureNavigation(elements) {
  const byId = new Map();
  const subscriptions = new Set();
  for (const element of elements) {
    if (!element.id || byId.has(element.id)) throw new Error('Navigation requires unique feature IDs');
    byId.set(element.id, element);
  }
  return {
    select(id) {
      if (!byId.has(id)) throw new Error(`Unknown navigation feature: ${id}`);
      for (const [key, element] of byId) {
        const active = key === id;
        element.classList.toggle('is-active', active);
        if (active) element.setAttribute('aria-current', 'page');
        else element.removeAttribute('aria-current');
      }
    },
    on(id, listener) {
      const element = byId.get(id);
      if (!element) throw new Error(`Unknown navigation feature: ${id}`);
      element.addEventListener('click', listener);
      const unsubscribe = () => {element.removeEventListener('click', listener);subscriptions.delete(unsubscribe);};
      subscriptions.add(unsubscribe);
      return unsubscribe;
    },
    dispose() {for (const unsubscribe of [...subscriptions]) unsubscribe();},
  };
}
