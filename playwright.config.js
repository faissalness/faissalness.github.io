module.exports = {
  testDir: './tests',
  testMatch: 'browser_emulator.spec.js',
  timeout: 60_000,
  use: {
    headless: true,
    viewport: { width: 390, height: 844 }
  }
};
