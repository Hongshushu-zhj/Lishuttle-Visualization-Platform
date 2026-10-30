const copy = value => JSON.parse(JSON.stringify(value));
const samePath = (a, b) => !!a && !!b && a.replaceAll('/', '\\').toLowerCase() === b.replaceAll('/', '\\').toLowerCase();
export function createDesktopModel({ api, state = {} }) {
  Object.assign(state, { settings: null, draft: {}, environment: { status: 'not_configured' }, onboarding: { completed: true },
    loaded: false, saving: false, checking: false, error: '', open: false, candidates: [], appInfo: null });
  let revision = 0, detection = null;
  const isReady = () => state.environment.status === 'passed' && samePath(state.environment.executable, state.settings?.matlabExe) && samePath(state.draft.matlabExe, state.settings?.matlabExe);
  async function load() {
    try {
      const [settings, environment, onboarding] = await Promise.all([api.getSettings(), api.getEnvironment(), api.getOnboarding()]);
      state.settings = copy(settings); state.draft = copy(settings); state.environment = environment; state.onboarding = onboarding;
      state.error = ''; state.loaded = true; revision++;
      if (environment.status === 'running') { detection = { id: environment.id, revision, executable: settings.matlabExe }; state.checking = true; }
    } catch (error) { state.error = error.message; throw error; }
  }
  function setMatlabPath(value) {
    if (state.draft.matlabExe === value) return;
    state.draft.matlabExe = value; revision++;
    state.environment = { status: value ? 'not_checked' : 'not_configured', executable: value }; state.checking = false;
  }
  async function save() {
    state.saving = true; state.error = '';
    const sent = copy(state.draft), currentRevision = revision;
    try {
      const saved = await api.patchSettings(sent); state.settings = copy(saved);
      // Preserve edits made while the request was in flight.
      if (currentRevision === revision && JSON.stringify(sent) === JSON.stringify(state.draft)) state.draft = copy(saved);
      const environment = await api.getEnvironment();
      if (currentRevision === revision && samePath(saved.matlabExe, state.draft.matlabExe)) state.environment = environment;
      return saved;
    } catch (error) { state.error = error.message; throw error; }
    finally { state.saving = false; }
  }
  async function startCheck() {
    await save(); const token = { revision, executable: state.settings.matlabExe };
    try {
      const result = await api.startEnvironmentCheck(token.executable); detection = { ...token, id: result.id };
      if (token.revision === revision) { state.environment = result; state.checking = result.status === 'running'; }
    } catch (error) { state.error = error.message; state.checking = false; throw error; }
  }
  async function pollCheck() {
    const token = detection; if (!token || !state.checking) return;
    try {
      const result = await api.getEnvironmentCheck(token.id);
      if (token.revision !== revision || detection !== token || !samePath(token.executable, state.draft.matlabExe)) return;
      state.environment = result; state.checking = result.status === 'running';
      if (!state.checking) detection = null;
    } catch (error) { state.error = error.message; throw error; }
  }
  async function cancelCheck() {
    if (detection && state.checking) await api.cancelEnvironmentCheck(detection.id);
  }
  async function completeOnboarding() {
    const result = await api.completeOnboarding(); state.onboarding = result;
  }
  return { state, isReady, load, setMatlabPath, save, startCheck, pollCheck, cancelCheck, completeOnboarding };
}
export function environmentLabel(value) {
  return { not_configured: 'MATLAB 未配置', not_checked: 'MATLAB 尚未检测', running: 'MATLAB 检测中', passed: 'MATLAB 就绪',
    cancelled: '检测已取消', timed_out: '检测超时', failed: 'MATLAB 检测失败' }[value?.status] || '等待环境信息';
}
