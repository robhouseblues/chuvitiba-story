// The day's X card (src/card.ts, /card/video) as a video, and its post's caption (src/caption.ts)
// beside it as text: the page opened in a headless browser on a stopped clock, its scene drawn a
// frame at a time (its pixel.js leaves that to us) and each frame handed to ffmpeg, so the video
// plays as smoothly as the page whatever the machine. The file is what X recommends: H.264 High
// in an MP4, 1280 x 720, 60 frames a second (each of the scene's 12 shown 5 times), with a silent
// AAC soundtrack. It checks what it can before it writes the caption: that the page had an answer
// (without one, the page refuses), that the font arrived, that the scene was drawn, and that the
// caption is there and fits a post. If any of that fails, it fails: never a card that looks right
// and says wrong. An empty caption is fine: the post is then the video alone.
//
//   node scripts/card-video.mjs [--url https://chuvitibahoje.com/card/video] [--saida card.mp4] [--legenda card.txt] [--segundos 10] [--relogio 2026-10-20T09:20:00Z]
//
// Needs Playwright's Chromium and ffmpeg on the PATH.

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { rm, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'https://chuvitibahoje.com/card/video' },
    saida: { type: 'string', default: 'card.mp4' },
    legenda: { type: 'string' },
    segundos: { type: 'string', default: '10' },
    relogio: { type: 'string' },
  },
});
const WIDTH = 1280;
const HEIGHT = 720;
const VIDEO_FPS = 60;
/** X's limit for a post. */
const MAX_CAPTION = 280;
const seconds = Number(values.segundos);
if (!(seconds >= 3 && seconds <= 60)) throw new Error('--segundos: a card video runs 3 to 60 seconds');
if (spawnSync('ffmpeg', ['-version']).error) throw new Error('ffmpeg is not on the PATH');
const captionFile = values.legenda ?? values.saida.replace(/\.mp4$/i, '') + '.txt';
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
  // Long enough for the scene to be laid out again for the font, 80 ms after it arrives.
  await page.clock.runFor(2000);
  const fps = await page.evaluate(() => window.chuvitibaQuadros?.fps ?? 12);
  if (VIDEO_FPS % fps !== 0) throw new Error(`the scene's ${fps} frames a second don't go into ${VIDEO_FPS}`);
  const caption = await page.evaluate(() => document.querySelector('meta[name="chuvitiba:legenda"]')?.getAttribute('content') ?? null);
  if (caption === null) throw new Error('no card: the page has no caption');
  if ([...caption].length > MAX_CAPTION) throw new Error(`no card: the caption is longer than ${MAX_CAPTION} characters`);

  const ffmpeg = spawn('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-t', String(seconds),
    '-vf', `fps=${VIDEO_FPS},scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`,
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '16', '-g', String(VIDEO_FPS * 2),
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    values.saida,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = once(ffmpeg, 'close');

  let checked = false;
  for (let i = 0; i < seconds * fps; i++) {
    await page.evaluate((t) => window.chuvitibaQuadros?.draw(t), i / fps);
    if (!checked) {
      checked = true;
      const drawn = await page.evaluate(() => {
        const picture = document.querySelector('img.arte');
        if (picture) return picture.complete && picture.naturalWidth > 0;
        const canvas = document.getElementById('art');
        if (!canvas?.width || !canvas.height) return false;
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let opaque = 0;
        for (let p = 3; p < pixels.length; p += 4) if (pixels[p] === 255) opaque++;
        // The scene covers its window: a sky, a place. Less than most of it is a scene that failed.
        return opaque > (pixels.length / 4) * 0.9;
      });
      if (!drawn) {
        ffmpeg.kill();
        await done;
        await rm(values.saida, { force: true });
        throw new Error('no card: the scene was not drawn');
      }
    }
    const png = await page.screenshot({ type: 'png' });
    if (!ffmpeg.stdin.write(png)) await once(ffmpeg.stdin, 'drain');
    await page.clock.runFor(1000 / fps);
  }
  ffmpeg.stdin.end();
  const [code] = await done;
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
  await writeFile(captionFile, caption ? `${caption}\n` : '');
  console.log(`${values.saida}: ${WIDTH} x ${HEIGHT}, ${seconds} s from ${values.url}; caption in ${captionFile}`);
} finally {
  await browser.close();
}
