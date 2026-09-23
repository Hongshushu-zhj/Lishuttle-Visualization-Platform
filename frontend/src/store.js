import { reactive } from 'vue';
import * as api from './api';

// 全局数据源状态:画图页与对比页共享
export const state = reactive({
  sources: [],
  loaded: false,
  backendOk: true,
  backendError: '',
});

export async function loadSources() {
  try {
    state.sources = await api.listSources();
    state.backendOk = true;
    state.backendError = '';
  } catch (e) {
    state.backendOk = false;
    state.backendError = e.message;
  }
  state.loaded = true;
}

export async function addSource(path) {
  const s = await api.addSource(path);
  await loadSources();
  return s;
}

export async function removeSource(id) {
  await api.deleteSource(id);
  await loadSources();
}

export async function refreshSource(id) {
  const s = await api.refreshSource(id);
  await loadSources();
  return s;
}

// 已注册数据源中"可绘图"的数据类型
export function knownTypes(source) {
  return Object.values(source.types || {}).filter((t) => t.known);
}
