module.exports = {
  testMatch: 'visual_qa.spec.js',
  timeout: 120_000,
  use: {
    headless: true,
    viewport: { width: 1280, height: 900 }
  }
};
