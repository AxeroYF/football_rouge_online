import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createV22PreviewServer } from './serve-v22-preview.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let require = createRequire(import.meta.url), chromium;
try { ({ chromium } = require('playwright')); } catch { require = createRequire(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/review.cjs')); ({ chromium } = require('playwright')); }
const output = path.join(root, 'outputs/v22-demo-review'); await fs.mkdir(output, { recursive: true });
const server = createV22PreviewServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, recordVideo: { dir: output, size: { width: 1440, height: 1080 } } });
const page = await context.newPage(), report = { errors: [], requests: [], checks: [] };
page.on('pageerror', e => report.errors.push(e.message));
page.on('response', r => { if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`); });
page.on('request', r => report.requests.push(r.url()));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/v22-preview.html`);
  await page.waitForFunction(() => window.v22Demo?.ready, { timeout: 20000 });
  await page.locator('#play').click(); await page.waitForTimeout(6000);
  report.checks.push({ name: 'natural playback', time: await page.evaluate(() => window.v22Demo.match.time) });
  await page.locator('#play').click();
  const time = await page.evaluate(() => window.v22Demo.match.time); await page.waitForTimeout(500);
  if (await page.evaluate(() => window.v22Demo.match.time) !== time) throw new Error('Pause failed');
  await page.locator('#home-tactic').selectOption('press'); await page.locator('#targets').check();
  await page.locator('#play').click(); await page.waitForTimeout(6000);
  await page.locator('#play').click(); await page.locator('#targets').uncheck();
  await page.evaluate(() => {
    const c = document.querySelector('#pitch'), rect = c.getBoundingClientRect();
    const scale = Math.max(.1, Math.min((rect.width - 28) / 111, (rect.height - 28) / 74));
    const p = window.v22Demo.match.players[9];
    c.dispatchEvent(new MouseEvent('click', { clientX: rect.left + (rect.width - 105 * scale) / 2 + p.x * scale, clientY: rect.top + (rect.height - 68 * scale) / 2 + p.y * scale, bubbles: true }));
  });
  await page.waitForTimeout(300);
  if (!(await page.locator('#player-detail').innerText()).includes('m/s')) throw new Error('Player inspector failed');
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.locator('.workspace').screenshot({ path: path.join(output, 'match-view.png') });
  report.checks.push({ name: 'tactic switch', plan: await page.evaluate(() => window.v22Demo.match.planKeys[0]) });
  if (await page.locator('input[type="range"]').count()) throw new Error('Unexpected match slider editor');
  report.checks.push({ name: 'saved-board presets only; no match slider editor' });
  await page.evaluate(() => {
    window.v22Demo.seek(0); const m = window.v22Demo.match; m.setPlan(0, 'wide');
    while (!m.finished && !m.players.some(p => p.team === 0 && p.action === '边后卫外线套上' && p.x > 55)) m.advance(.5);
    if (m.finished) throw new Error('No natural overlapping run');
  });
  await page.locator('#targets').check(); await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(output, 'overlapping-run.png'), fullPage: true });
  report.checks.push({ name: 'natural fullback overlap', time: await page.evaluate(() => window.v22Demo.match.time) });
  await page.locator('#home-tactic').selectOption('inverted');
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(output, 'inverted-fullback.png'), fullPage: true });
  await page.locator('#targets').uncheck();
  await page.evaluate(() => { window.v22Demo.seek(0); const m = window.v22Demo.match; while (!m.finished && m.phase !== 'var') m.advance(.05); });
  await page.waitForTimeout(350);
  if (await page.evaluate(() => window.v22Demo.match.phase) !== 'var') throw new Error('No VAR event in complete demo');
  await page.screenshot({ path: path.join(output, 'var-review.png'), fullPage: true });
  report.checks.push({ name: 'VAR screenshot', minute: await page.evaluate(() => window.v22Demo.match.minute) });
  await page.evaluate(() => window.v22Demo.seek(38));
  for (const [name, viewport] of [['ipad', { width: 768, height: 1024 }], ['mobile', { width: 390, height: 844 }], ['landscape', { width: 780, height: 360 }]]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(200);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error(`${name}: horizontal overflow`);
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    report.checks.push({ name: `${name} responsive`, overflow: false });
  }
  const requestCount = report.requests.length;
  await page.evaluate(() => window.v22Demo.setPlaying(true)); await page.waitForTimeout(3000);
  if (report.requests.length !== requestCount) throw new Error('Playback unexpectedly requested server data');
  await page.evaluate(() => window.v22Demo.seek(480));
  report.result = await page.evaluate(() => ({ score: window.v22Demo.match.score, stats: window.v22Demo.match.stats, finished: window.v22Demo.match.finished }));
  report.ok = report.errors.length === 0; if (!report.ok) throw new Error(report.errors.join('\n'));
} finally {
  await context.close(); const video = await page.video()?.path(); if (video) { await fs.copyFile(video, path.join(output, 'demo-recording.webm')); report.video = 'demo-recording.webm'; }
  await browser.close(); await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ ok: report.ok, checks: report.checks, result: report.result, output }, null, 2));
