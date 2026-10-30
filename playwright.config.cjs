const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({ testDir: './desktop/tests', testMatch: '**/*.electron.cjs',
  workers: 1, timeout: 60000, reporter: 'list', outputDir: '.desktop-test-data/playwright' });
