// The Story workflow's side of the day's post on X (.github/workflows/story.yml; the site's src/x.ts):
// hands the Worker the card's video and caption for its request. The Worker decides whether it goes
// out; here it is only delivered. The call carries the run's identity token from GitHub, as
// story-post.mjs's do.
//
//   node scripts/card-post.mjs --pedido <id> [--video card.mp4] [--legenda card.txt] [--site https://chuvitibahoje.com]
//
// Runs on GitHub Actions only: the job needs `permissions: id-token: write`.

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    pedido: { type: 'string' },
    video: { type: 'string', default: 'card.mp4' },
    legenda: { type: 'string', default: 'card.txt' },
    site: { type: 'string', default: 'https://chuvitibahoje.com' },
  },
});
if (!/^[0-9a-f]{32}$/.test(values.pedido ?? '')) throw new Error('--pedido: the request id the Worker started the run with');
/** What the site expects in the token's audience (its src/oidc.ts). */
const AUDIENCE = 'https://chuvitibahoje.com';

const { ACTIONS_ID_TOKEN_REQUEST_URL: url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: token } = process.env;
if (!url || !token) throw new Error('no identity token: run this on GitHub Actions, with permissions: id-token: write');
const identity = await fetch(`${url}&audience=${encodeURIComponent(AUDIENCE)}`, { headers: { authorization: `bearer ${token}` } });
if (!identity.ok) throw new Error(`GitHub gave no identity token (${identity.status})`);

const form = new FormData();
form.set('legenda', await readFile(values.legenda, 'utf8'));
form.set('video', new Blob([await readFile(values.video)], { type: 'video/mp4' }), 'card.mp4');
const response = await fetch(`${values.site}/story/card?pedido=${values.pedido}`, {
  method: 'POST',
  body: form,
  headers: { authorization: `Bearer ${(await identity.json()).value}` },
});
const body = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(`/story/card: ${response.status} ${body.erro ?? ''}`.trim());
console.log(`card handed in: ${body.estado}`);
