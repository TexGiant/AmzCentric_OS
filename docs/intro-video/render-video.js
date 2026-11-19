// node render-video.js <dir> preview t1,t2,...   → PNG stills
// node render-video.js <dir> render <out.mp4> [fps]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
(async () => {
  const [dir, mode, arg, fpsArg] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await p.goto('file://' + dir + '/index.html', { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  const total = await p.evaluate(() => window.TOTAL);
  if (mode === 'preview') {
    for (const t of arg.split(',').map(Number)) {
      await p.evaluate((t) => window.seek(t), t);
      await p.screenshot({ path: `${dir}/preview-${String(t).padStart(5, '0')}.png` });
    }
    console.log('total', total);
  } else {
    const fps = Number(fpsArg || 30), n = Math.ceil(total * fps);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', arg], { stdio: ['pipe', 'inherit', 'inherit'] });
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      await p.evaluate((t) => window.seek(t), i / fps);
      const buf = await p.screenshot({ type: 'jpeg', quality: 93 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % 300 === 0) console.log(`frame ${i}/${n} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log('done', n, 'frames in', ((Date.now() - t0) / 1000).toFixed(0), 's');
  }
  await b.close();
})();
