import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://127.0.0.1:4173/';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

// ---------- Scenario 1: intro plays automatically, then game menu appears ----------
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__A_CIGARETTES_LIFE__), null, { timeout: 30000 });
await page.waitForTimeout(900);
const introState = await page.evaluate(() => {
  const overlay = document.getElementById('intro-overlay');
  const frame = document.getElementById('intro-frame');
  let frameText = '';
  let frameTitle = '';
  try {
    frameText = frame?.contentDocument?.body?.innerText ?? '';
    frameTitle = frame?.contentDocument?.title ?? '';
  } catch (error) {
    frameText = 'INACCESSIBLE';
  }
  return {
    overlayPresent: Boolean(overlay),
    overlayVisible: overlay ? getComputedStyle(overlay).display !== 'none' : false,
    frameSrc: frame?.getAttribute('src') ?? null,
    frameTitle,
    frameText: frameText.slice(0, 40),
    menuVisible: Boolean(document.querySelector('.ui-menu')),
  };
});
console.log('INTRO PLAYING:', JSON.stringify(introState, null, 2));
await page.screenshot({ path: 'smoke/intro-01-playing.png' });
await page.waitForSelector('#intro-overlay', { state: 'detached', timeout: 15000 });
await page.waitForTimeout(500);
const afterAuto = await page.evaluate(() => ({
  overlayPresent: Boolean(document.getElementById('intro-overlay')),
  introDataset: document.documentElement.dataset.intro ?? null,
  menuVisible: Boolean(document.querySelector('.ui-menu')),
  menuButtons: Array.from(document.querySelectorAll('.ui-menu button')).map((b) => b.textContent?.trim()).filter(Boolean),
}));
console.log('AFTER AUTO INTRO:', JSON.stringify(afterAuto, null, 2));
await page.screenshot({ path: 'smoke/intro-02-menu-after.png' });

// Enter the game to prove the flow continues past the intro.
await page.evaluate(() => {
  const app = window.__A_CIGARETTES_LIFE__;
  app.game.newGame({
    playerName: 'Intro Test',
    appearance: { bodyColor: '#f7f3e8', filterColor: '#b07a4a', accessory: null, face: 'smile', pattern: 'plain' },
  });
});
await page.waitForTimeout(3000);
console.log('AFTER NEW GAME:', JSON.stringify(await page.evaluate(() => ({
  screen: window.__A_CIGARETTES_LIFE__.game.getScreen(),
  scenes: window.__A_CIGARETTES_LIFE__.phaser.scene.getScenes(true).map((s) => s.scene.key),
  overlayPresent: Boolean(document.getElementById('intro-overlay')),
}))));

// ---------- Scenario 2: ?skipIntro=1 boots straight into the menu ----------
await page.goto(BASE + '?skipIntro=1', { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__A_CIGARETTES_LIFE__), null, { timeout: 30000 });
await page.waitForTimeout(1200);
const skipParam = await page.evaluate(() => ({
  overlayPresent: Boolean(document.getElementById('intro-overlay')),
  menuVisible: Boolean(document.querySelector('.ui-menu')),
}));
console.log('SKIP PARAM:', JSON.stringify(skipParam));

// ---------- Scenario 3: clicking inside the intro skips it immediately ----------
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__A_CIGARETTES_LIFE__), null, { timeout: 30000 });
await page.waitForTimeout(1200);
await page.mouse.click(720, 450);
await page.waitForSelector('#intro-overlay', { state: 'detached', timeout: 5000 });
const clickSkip = await page.evaluate(() => ({
  overlayPresent: Boolean(document.getElementById('intro-overlay')),
  menuVisible: Boolean(document.querySelector('.ui-menu')),
}));
console.log('CLICK SKIP:', JSON.stringify(clickSkip));

// ---------- Scenario 4: keyboard skips the intro ----------
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__A_CIGARETTES_LIFE__), null, { timeout: 30000 });
await page.waitForTimeout(900);
await page.keyboard.press('Space');
await page.waitForSelector('#intro-overlay', { state: 'detached', timeout: 5000 });
console.log('KEYBOARD SKIP:', JSON.stringify(await page.evaluate(() => ({ overlayPresent: Boolean(document.getElementById('intro-overlay')) }))));

// ---------- Scenario 5: explicit SKIP button ----------
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__A_CIGARETTES_LIFE__), null, { timeout: 30000 });
await page.waitForTimeout(700);
await page.locator('#intro-skip').click();
await page.waitForSelector('#intro-overlay', { state: 'detached', timeout: 5000 });
console.log('BUTTON SKIP: PASS');
await page.screenshot({ path: 'smoke/intro-03-skipped-menu.png' });

console.log('CONSOLE ERRORS:', JSON.stringify(errors.slice(0, 10), null, 2));
await browser.close();
