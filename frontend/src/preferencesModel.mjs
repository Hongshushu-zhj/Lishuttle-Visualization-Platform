export function createPreferencesClient({ read, write }) {
  let state, initialization, queue = Promise.resolve();
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) listener(structuredClone(state)); };
  const initialize = () => initialization ||= read().then(value => { state = structuredClone(value); notify(); return structuredClone(state); });
  return {
    initialize,
    get: () => structuredClone(state),
    subscribe(listener) { listeners.add(listener); if (state) listener(structuredClone(state)); return () => listeners.delete(listener); },
    updateSection(section, key, value) {
      if (!['colorRanges', 'analysisConfig'].includes(section)) return Promise.reject(new Error('偏好分区无效'));
      const operation = queue.then(async () => {
        await initialize();
        const next = { ...state[section], [key]: structuredClone(value) };
        const saved = await write({ [section]: next }); state = structuredClone(saved); notify(); return structuredClone(state);
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}
