// Renders docs/icons/*.svg to the PNG sizes iPhone and the web manifest need.
// Run: node tests/render-icons.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'docs', 'icons');
const jobs = [
  ['icon.svg', 'icon-180.png', 180],
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
];

(async () => {
  const browser = await chromium.launch();
  for (const [src, out, size] of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const svg = fs.readFileSync(path.join(dir, src), 'utf8');
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: path.join(dir, out), omitBackground: false });
    await page.close();
  }
  await browser.close();
  console.log('icons rendered');
})();
