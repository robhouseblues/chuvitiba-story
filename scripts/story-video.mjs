// The day's Story as a video (chuvitiba-hoje's src/story.ts): the Story page opened in a headless browser on a
// stopped clock, its scene drawn a frame at a time (its pixel.js leaves that to us) and each frame
// handed to ffmpeg, so the video plays as smoothly as the page whatever the machine. The MP4 is
// what Instagram takes for a Story: H.264, 1080 x 1920, 24 frames a second (each of the
// scene's 12 shown twice), with a silent soundtrack, which Instagram's rules for video expect,
// its index at the front and no edit lists.
//
//   node scripts/story-video.mjs [--url https://chuvitibahoje.com/story] [--saida story.mp4] [--segundos 10] [--relogio 2026-10-24T13:00:00Z]
//
// `--relogio` sets the page's clock (the day's passers-by, a weekend's, are by its date); the real time otherwise.
//
// Needs Playwright's Chromium (npx playwright install chromium) and ffmpeg on the PATH.

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'https://chuvitibahoje.com/story' },
    saida: { type: 'string', default: 'story.mp4' },
    segundos: { type: 'string', default: '10' },
    relogio: { type: 'string' },
  },
});
const seconds = Number(values.segundos);
if (!(seconds >= 3 && seconds <= 60)) throw new Error('--segundos: a Story video runs 3 to 60 seconds');
if (spawnSync('ffmpeg', ['-version']).error) throw new Error('ffmpeg is not on the PATH');

const WIDTH = 1080;
const HEIGHT = 1920;
const VIDEO_FPS = 24;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
  // The clock reads the real time, and only moves when we move it.
  const start = values.relogio ? Date.parse(values.relogio) : Date.now();
  if (!Number.isFinite(start)) throw new Error(`--relogio: not a date: ${values.relogio}`);
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start);
  await page.addInitScript(() => {
    window.chuvitibaGravando = true;
  });
  const response = await page.goto(values.url, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`${values.url}: ${response?.status() ?? 'no response'}`);
  await page.evaluate(() => document.fonts.ready);
  // Long enough for what the page does on timers once it is up: the scene laid out again for
  // the font, 80 ms after it arrives.
  await page.clock.runFor(2000);
  // A hand-drawn picture with nothing moving in it never asks to be drawn: its frames are all one.
  const fps = await page.evaluate(() => window.chuvitibaQuadros?.fps ?? 12);
  if (VIDEO_FPS % fps !== 0) throw new Error(`the scene's ${fps} frames a second don't go into ${VIDEO_FPS}`);

  const ffmpeg = spawn('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-t', String(seconds),
    // Each frame repeated up to 24 a second, in the colours of HD video.
    '-vf', `fps=${VIDEO_FPS},scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`,
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    // No B-frames: without an edit list, they would start the picture two frames after the sound.
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '16', '-g', String(VIDEO_FPS * 2), '-bf', '0',
    '-c:a', 'aac', '-b:a', '128k',
    // The index first, so Instagram can start reading at once, and no edit lists, which it refuses.
    '-movflags', '+faststart', '-use_editlist', '0',
    values.saida,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = once(ffmpeg, 'close');

  for (let i = 0; i < seconds * fps; i++) {
    await page.evaluate((t) => window.chuvitibaQuadros?.draw(t), i / fps);
    const png = await page.screenshot({ type: 'png' });
    if (!ffmpeg.stdin.write(png)) await once(ffmpeg.stdin, 'drain');
    await page.clock.runFor(1000 / fps);
  }
  ffmpeg.stdin.end();
  const [code] = await done;
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
  console.log(`${values.saida}: ${seconds} s from ${values.url}`);
} finally {
  await browser.close();
}
