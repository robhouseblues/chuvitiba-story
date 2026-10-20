// The day's X card (chuvitiba-hoje's src/card.ts) as a PNG, and its post's caption (its
// src/caption.ts) beside it as text: the card page opened in a headless browser on a stopped
// clock, its scene drawn once (its pixel.js leaves that to us), screenshotted at 1600 x 900, and
// the caption read from the same page, so the two come from the one forecast. It checks what it
// can before it writes anything: that the page had an answer to give (without one, the page
// refuses, and there is no card), that the font arrived, that the scene was drawn, that the
// image came out the size it should, and that the caption is there and fits a post. If any of
// that fails, it fails, and writes nothing: never a card that looks right and says wrong. An
// empty caption is fine: the post is then the picture alone.
//
//   node scripts/story-card.mjs [--url https://chuvitibahoje.com/card] [--saida card.png] [--legenda card.txt] [--relogio 2026-10-20T09:20:00Z]
//
// The same page on the same clock (--relogio) makes the same card. Needs Playwright's Chromium.

import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'https://chuvitibahoje.com/card' },
    saida: { type: 'string', default: 'card.png' },
    legenda: { type: 'string' },
    relogio: { type: 'string' },
  },
});
const WIDTH = 1600;
const HEIGHT = 900;
/** X's limit for a post. */
const MAX_CAPTION = 280;
const captionFile = values.legenda ?? values.saida.replace(/\.png$/i, '') + '.txt';
/** The moment of the scene's motion the card shows (people mid-stride, the clouds where they are then): always the same one. */
const MOMENT_S = 4;
const start = values.relogio ? Date.parse(values.relogio) : Date.now();
if (!Number.isFinite(start)) throw new Error(`--relogio: not a date: ${values.relogio}`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start);
  await page.addInitScript(() => {
    window.chuvitibaGravando = true;
  });
  const response = await page.goto(values.url, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`no card: ${values.url} answered ${response?.status() ?? 'nothing'}: ${((await response?.text()) ?? '').trim()}`);
  await page.evaluate(() => document.fonts.ready);
  const font = await page.evaluate(() => [...document.fonts].some((face) => face.family.includes('Pixelify') && face.status === 'loaded'));
  if (!font) throw new Error('no card: the Pixelify Sans font did not load');
  // The scene laid out again for the font, 80 ms after it arrives, then drawn at its moment.
  await page.clock.runFor(2000);
  await page.evaluate((t) => window.chuvitibaQuadros?.draw(t), MOMENT_S);
  const drawn = await page.evaluate(() => {
    const picture = document.querySelector('img.arte');
    if (picture) return picture.complete && picture.naturalWidth > 0;
    const canvas = document.getElementById('art');
    if (!canvas?.width || !canvas.height) return false;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] === 255) opaque++;
    // The scene covers its window: a sky, a place. Less than most of it is a scene that failed.
    return opaque > (pixels.length / 4) * 0.9;
  });
  if (!drawn) throw new Error('no card: the scene was not drawn');
  const caption = await page.evaluate(() => document.querySelector('meta[name="chuvitiba:legenda"]')?.getAttribute('content') ?? null);
  if (caption === null) throw new Error('no card: the page has no caption');
  if ([...caption].length > MAX_CAPTION) throw new Error(`no card: the caption is longer than ${MAX_CAPTION} characters`);
  const png = await page.screenshot({ type: 'png' });
  // A PNG says its size in its header: width and height, 4 bytes each, from byte 16.
  const size = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (size[0] !== WIDTH || size[1] !== HEIGHT) throw new Error(`no card: it came out ${size.join(' x ')}`);
  await writeFile(values.saida, png);
  await writeFile(captionFile, caption ? `${caption}\n` : '');
  console.log(`${values.saida}: ${WIDTH} x ${HEIGHT} from ${values.url}; caption in ${captionFile}`);
} finally {
  await browser.close();
}
