# chuvitiba-story

Records the daily Instagram Story of [Chuvitiba Hoje](https://chuvitibahoje.com/) ([@chuvitibahoje](https://www.instagram.com/chuvitibahoje/)), the site that says whether you need an umbrella in Curitiba today.

Each morning at 6:20 (Curitiba) the site asks this repository's workflow, "Story do dia", to record [chuvitibahoje.com/story](https://chuvitibahoje.com/story): the day's answer over its pixel-art scene. The workflow opens the page in a headless browser, draws it a frame at a time, and makes a 10-second video of it, 1080 x 1920, as Instagram takes for a Story. It hands the video back to the site, which posts it at 6:30.

- `scripts/story-video.mjs`: the recorder. Playwright's Chromium and ffmpeg.
- `scripts/story-post.mjs`: hands the video to the site and waits until the Story is up. Each call carries the run's identity token from GitHub (OpenID Connect), which is how the site knows the call is from this workflow, on main. There is no secret here.
- `.github/workflows/story.yml`: the workflow. Started only by the site (or by hand, without a `pedido`, to record a video and do nothing else with it).

To record one yourself:

```bash
npm install
npx playwright install chromium
npm run video -- --url https://chuvitibahoje.com/story --saida story.mp4
```

The site's own code is in a private repository; `story-video.mjs` is kept the same as the copy there.
