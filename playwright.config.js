const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8767',
    headless: true,
    viewport: { width: 1280, height: 720 }
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'python -m http.server 8767 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8767',
    reuseExistingServer: true,
    timeout: 30000
  }
});
