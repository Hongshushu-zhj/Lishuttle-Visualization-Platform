import { getPreferences, patchPreferences } from './api';
import { createPreferencesClient } from './preferencesModel.mjs';
export const preferences = createPreferencesClient({ read: getPreferences, write: patchPreferences });
export const initializePreferences = preferences.initialize;
