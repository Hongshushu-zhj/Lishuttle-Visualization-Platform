import { reactive } from 'vue';
import * as api from './api';
import { createAppModel } from './appModel.mjs';
export const app = createAppModel({ api, state: reactive({}) });
export function ensurePlotReady() {
  if (app.isReady()) return true;
  app.state.open = true; return false;
}
