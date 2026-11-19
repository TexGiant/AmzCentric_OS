# Intro video

Re-records the team intro video (`AmzCentric-OS-Intro.mp4`, 1920×1080, ~110 s) from the app's demo data.

```bash
# 1. Build and run the app in demo mode (no Supabase env) on :3100
npm run build && PORT=3100 npm start

# 2. In a work folder (e.g. /tmp/intro): fonts, logo, screenshots
mkdir -p /tmp/intro/shots /tmp/intro/fonts
cp public/brand/amzcentric-logo.png /tmp/intro/logo.png
#    fonts/local.css + Manrope/Montserrat .woff2 files (Google Fonts, latin subset)
node docs/intro-video/capture.js /tmp/intro/shots

# 3. Compose and render (Playwright + ffmpeg)
node docs/intro-video/build-video.js /tmp/intro
node docs/intro-video/render-video.js /tmp/intro preview 10,30,60   # stills to check
node docs/intro-video/render-video.js /tmp/intro render /tmp/intro/intro-silent.mp4 30

# 4. Music (licensed track, not stored in the repo) faded in/out
ffmpeg -i /tmp/intro/intro-silent.mp4 -i music.mp3 \
  -filter_complex "[1:a]volume=0.85,afade=t=in:d=0.8,afade=t=out:st=106.9:d=3.5[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest AmzCentric-OS-Intro.mp4
```

Scenes, captions and spotlight timings live in `build-video.js`. Music: "A Beginning" (Rymdklang Soundtracks), Epidemic Sound, edited to 110.4 s.

## Claude connector launch video

`AmzCentric-OS-Claude-Connector-Launch.mp4` (~69 s). Build the app with `NEXT_PUBLIC_SITE_URL=http://localhost:3100` in demo mode, run it on :3100, then:

```bash
node docs/intro-video/launch-data.mjs /tmp/launch/shots   # connects like Claude, records real tool answers + consent/settings screenshots
# crop the consent card to shots/consent-crop.png, copy fonts/ and logo.png into /tmp/launch
node docs/intro-video/build-launch.js /tmp/launch
node docs/intro-video/render-video.js /tmp/launch render /tmp/launch/launch-silent.mp4 30
```
