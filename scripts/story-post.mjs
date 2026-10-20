// The Story workflow's side of posting (.github/workflows/story.yml; the site's src/instagram.ts): hands
// the Worker the video recorded for its request, then asks how it is going every 15 seconds
// until the Story is up on Instagram, has failed, or (a test) is only kept. Each call carries
// the run's identity token from GitHub (OpenID Connect), which is how the Worker knows it is
// this workflow calling (the site's src/oidc.ts). With --falhou, it tells the Worker the recording failed.
//
//   node scripts/story-post.mjs --pedido <id> [--video story.mp4] [--site https://chuvitibahoje.com]
//   node scripts/story-post.mjs --pedido <id> --falhou
//
// Runs on GitHub Actions only: the job needs `permissions: id-token: write`.

import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    pedido: { type: 'string' },
    video: { type: 'string', default: 'story.mp4' },
    site: { type: 'string', default: 'https://chuvitibahoje.com' },
    falhou: { type: 'boolean', default: false },
  },
});
if (!/^[0-9a-f]{32}$/.test(values.pedido ?? '')) throw new Error('--pedido: the request id the Worker started the run with');
/** What the site expects in the token's audience (its src/oidc.ts). */
const AUDIENCE = 'https://chuvitibahoje.com';
const EVERY_MS = 15_000;
/** Instagram takes a minute or two; the morning's waits for 6:30. Longer than this, the Worker's cron carries on. */
const GIVE_UP_MS = 20 * 60 * 1000;

/** A fresh identity token for this run (they last minutes). */
async function identity() {
  const { ACTIONS_ID_TOKEN_REQUEST_URL: url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: token } = process.env;
  if (!url || !token) throw new Error('no identity token: run this on GitHub Actions, with permissions: id-token: write');
  const response = await fetch(`${url}&audience=${encodeURIComponent(AUDIENCE)}`, { headers: { authorization: `bearer ${token}` } });
  if (!response.ok) throw new Error(`GitHub gave no identity token (${response.status})`);
  return (await response.json()).value;
}

async function call(path, init = {}) {
  const response = await fetch(`${values.site}${path}?pedido=${values.pedido}`, {
    method: 'POST',
    ...init,
    headers: { authorization: `Bearer ${await identity()}`, ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${body.erro ?? ''}`.trim());
  return body;
}

const say = (state) => console.log(`${new Date().toISOString()} ${state.estado}${state.erro ? `: ${state.erro}` : ''}`);

if (values.falhou) {
  say(await call('/story/falhou'));
} else {
  const video = await readFile(values.video);
  let state = await call('/story/video', { body: video, headers: { 'content-type': 'video/mp4' } });
  say(state);
  const start = Date.now();
  while (!state.fim && Date.now() - start < GIVE_UP_MS) {
    await sleep(EVERY_MS);
    try {
      state = await call('/story/avancar');
    } catch (error) {
      // One call that didn't go through is no reason to stop asking.
      console.log(`${new Date().toISOString()} ${error.message}`);
      continue;
    }
    say(state);
  }
  if (!state.fim) console.log('Still under way: the Worker carries on from here, every few minutes in the morning.');
  if (state.estado === 'erro') process.exitCode = 1;
}
