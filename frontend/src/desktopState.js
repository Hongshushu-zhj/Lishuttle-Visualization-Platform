import { reactive } from 'vue';
import * as api from './api';
import { createDesktopModel } from './desktopModel.mjs';
export const desktop = createDesktopModel({ api, state: reactive({}) });
export function ensurePlotReady() {
  if (desktop.isReady()) return true;
  desktop.state.open = true; return false;
}
