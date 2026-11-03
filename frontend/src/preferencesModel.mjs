export function createPreferencesClient({ read, write }) {
  let state, initialization, queue = Promise.resolve();
  const listeners = new Set();
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const notify = () => { for (const listener of listeners) listener(clone(state)); };
  function initialize({ force = false } = {}) {
    if (force) initialization = undefined;
    if (!initialization) initialization = Promise.resolve().then(read).then(value => {
      state = clone(value); notify(); return clone(state);
    }).catch(error => { initialization = undefined; throw error; });
    return initialization;
  }
  return {
    initialize,
    get: () => clone(state),
    subscribe(listener) { listeners.add(listener); if (state) listener(clone(state)); return () => listeners.delete(listener); },
    updateSection(section, key, value) {
      if (!['colorRanges', 'analysisConfig'].includes(section)) return Promise.reject(new Error('偏好分区无效'));
      const operation = queue.then(async () => {
        await initialize();
        const saved = await write({ [section]: { [key]: clone(value) } });
        state = clone(saved); notify(); return clone(state);
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}
