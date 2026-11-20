import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {uiMotionEnabled} from '../versus/public/ui-motion.js';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH ?? import.meta.url);
const browser = await require('playwright').chromium.launch({
  executablePath:process.env.CHROME_PATH, headless:true,
});
try {
  const base = new URL('../versus/public/', import.meta.url);
  const index = await readFile(new URL('index.html', base), 'utf8');
  const page = await browser.newPage();
  await page.setContent('<section class="fusion-workspace"><section class="fusion-stage"><div class="fusion-duel"><div data-enhancement-drop="main"></div><div class="fusion-reveal"><div class="enhancement-result-frame"><div class="s4-player-card"></div></div></div></div></section></section>');
  for (const [,file] of index.matchAll(/rel="stylesheet" href="\/versus\/([^"]+)"/g)) {
    await page.addStyleTag({content:await readFile(new URL(file,base),'utf8')});
  }
  for (const reduced of [false,true]) {
    await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
    for (const preference of ['system','on','off']) {
      const enabled = uiMotionEnabled(preference,reduced);
      for (const phase of ['scanning','success','failure']) {
        const duration = await page.evaluate(({enabled,phase})=>{
          document.documentElement.dataset.uiMotion = enabled?'on':'off';
          document.querySelector('.fusion-workspace').className = 'fusion-workspace phase-'+phase;
          const element = document.querySelector(phase==='scanning'?'[data-enhancement-drop]':'.s4-player-card');
          return getComputedStyle(element).animationName==='none'?0:parseFloat(getComputedStyle(element).animationDuration);
        },{enabled,phase});
        assert.equal(duration >= .5,enabled,JSON.stringify({reduced,preference,phase,duration}));
      }
    }
  }
  console.log('Verified 18 fusion phase and motion-preference combinations');
} finally {
  await browser.close();
}
