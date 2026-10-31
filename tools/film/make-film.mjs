#!/usr/bin/env node
// Renders the Yūzakura short film from the live scene, on your own GPU.
//
//   cd tools/film
//   npm install
//   npx playwright install chromium     # or pass --chrome to use Google Chrome
//   node make-film.mjs                  # 4K UHD, 24 fps → out/yuzakura-4k.mp4
//
// Every frame is stepped deterministically (1/fps of scene time), rendered
// supersampled, captured losslessly and downscaled with a Lanczos filter, so
// there is no frame interpolation or upscaling anywhere. Rendering resumes
// where it stopped if interrupted.
//
// Options
//   --width 3840 --height 1608   picture size; the film is letterboxed to 16:9
//   --ss 1.5                     supersampling: frames render at width × ss
//   --fps 24
//   --blur 1                     sub-frames averaged into each frame (motion blur)
//   --quality ultra              scene quality preset (ultra | high | medium)
//   --chrome                     use the installed Google Chrome
//   --headless                   no browser window (GPU support varies by system)
//   --hevc                       encode 10-bit HEVC instead of H.264
//   --only opening,koi           render only these shots (no final film)
//   --max-frames N               render at most N frames per shot (testing)
//   --out out/yuzakura-4k.mp4
//   --three path                 serve a local three.module.min.js (offline use)
//
// Needs Node 18+, ffmpeg on the PATH, and Python 3 with NumPy for the score.

import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

// ---- Options -----------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const W = +opt('width', 3840);
const H = +opt('height', 1608);
const SS = +opt('ss', 1.5);
const FPS = +opt('fps', 24);
const BLUR = Math.max(1, Math.round(+opt('blur', 1)));
const QUALITY = opt('quality', 'ultra');
const MAX_FRAMES = +opt('max-frames', Infinity);
const ONLY = opt('only', '') ? String(opt('only')).split(',') : null;
const HEVC = !!opt('hevc', false);
const OUT = path.resolve(HERE, opt('out', `out/yuzakura-${W >= 3840 ? '4k' : W + 'p'}.mp4`));
const WORK = path.join(HERE, 'out', `${W}x${H}@${SS}x-${FPS * BLUR}fps-${QUALITY}`);

// ---- The edit ----------------------------------------------------------------------
// Each shot starts the scene at a point on its cinematic path (t, seconds) or at a
// fixed camera (cam=radius,height,azimuth,look). Shots are joined with 0.5 s dissolves;
// the score is timed to these cuts.
const XFADE = 0.5;
const SHOTS = [
  { name: 'opening', query: 't=0&fov=38', seconds: 5.0 },
  { name: 'giant', query: 't=66&fov=34', seconds: 4.0 },
  { name: 'curtain', query: 't=96&fov=32', seconds: 4.5 },
  { name: 'koi', query: 'cam=10.2,2.6,2.65,-1.6&fov=34', seconds: 4.0 },
  { name: 'frontlit', query: 't=148&fov=30', seconds: 4.0 },
  { name: 'bridge', query: 't=220&fov=30', seconds: 2.5 },
  { name: 'closing', query: 't=44&fov=37', seconds: 3.6 },
];
const TOTAL = SHOTS.reduce((a, s) => a + s.seconds, 0) - XFADE * (SHOTS.length - 1);

// ---- Static server for the scene ---------------------------------------------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, path.normalize(p));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

const run = (cmd, args) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  p.on('error', reject);
  p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
});
const fmtTime = (s) => (s < 90 ? `${s.toFixed(0)} s` : `${(s / 60).toFixed(1)} min`);

async function launch() {
  return chromium.launch({
    channel: opt('chrome', false) ? 'chrome' : undefined,
    headless: !!opt('headless', false),
    args: [
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--force_high_performance_gpu',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--enable-unsafe-swiftshader',
    ],
  });
}

async function renderShot(browser, port, shot) {
  const dir = path.join(WORK, shot.name);
  fs.mkdirSync(dir, { recursive: true });
  const count = Math.min(MAX_FRAMES, Math.ceil(shot.seconds * FPS)) * BLUR;
  const done = fs.readdirSync(dir).filter((f) => /^f\d+\.png$/.test(f)).length;
  if (done >= count) return console.log(`  ${shot.name}: done`);

  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SS });
  const page = await context.newPage();
  const three = opt('three', false);
  if (three) {
    await page.route(/three@[\d.]+\/build\/three\.module\.min\.js$/, (r) =>
      r.fulfill({ path: path.resolve(String(three)), contentType: 'text/javascript' }));
  }
  page.on('pageerror', (e) => console.error(`  page error: ${e.message}`));
  const url = `http://localhost:${port}/?frames=1&quality=${QUALITY}&maxdpr=${SS}&maxpx=1e9&${shot.query}`;
  await page.goto(url);
  await page.waitForFunction(() => (window.__frames || 0) >= 1, null, { timeout: 15 * 60 * 1000, polling: 500 });

  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  if (shot === SHOTS.find((s) => !ONLY || ONLY.includes(s.name))) {
    console.log(`  GPU: ${gpu}`);
    if (/swiftshader|llvmpipe|software/i.test(gpu)) {
      console.warn('  Warning: WebGL is running in software, which takes minutes per 4K frame.\n' +
        '  Run without --headless, or try --chrome, to use the GPU.');
    }
  }

  const dt = 1 / (FPS * BLUR);
  // Resuming: replay the frames already on disk so the simulation matches.
  for (let i = 0; i < done; i++) await page.evaluate((d) => window.__step(d), dt);
  const t0 = Date.now();
  for (let i = done; i < count; i++) {
    await page.evaluate((d) => window.__step(d), dt);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.png`), timeout: 10 * 60 * 1000 });
    const n = i - done + 1;
    if (n === 1 || n % 12 === 0 || i === count - 1) {
      const per = (Date.now() - t0) / 1000 / n;
      process.stdout.write(`\r  ${shot.name}: ${i + 1}/${count}  ${per.toFixed(2)} s/frame  ~${fmtTime(per * (count - i - 1))} left   `);
    }
  }
  process.stdout.write('\n');
  await context.close();
}

async function renderTitles(browser) {
  const dir = path.join(WORK, 'titles');
  fs.mkdirSync(dir, { recursive: true });
  // Laid out on a 1920-wide canvas and rendered at the film's resolution.
  const vw = 1920, vh = Math.round((1920 * H) / W);
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: W / vw });
  const page = await context.newPage();
  const css = `
    html,body{margin:0;width:${vw}px;height:${vh}px;background:transparent;overflow:hidden}
    .wrap{position:absolute;inset:0;display:grid;place-items:center;color:#f7ede9;text-align:center;
      text-shadow:0 2px 30px rgba(20,8,16,.55),0 0 2px rgba(20,8,16,.4)}
    .ja{font-family:'Shippori Mincho',serif;font-weight:600}
    .en{font-family:'Cormorant Garamond',serif}`;
  const cards = {
    open: `<div class="wrap"><div style="transform:translateY(40px)">
      <div class="ja" style="font-size:132px;letter-spacing:.12em;line-height:1">夕桜</div>
      <div class="en" style="font-size:30px;letter-spacing:.62em;margin-top:26px;padding-left:.62em">YŪZAKURA</div>
    </div></div>`,
    close: `<div class="wrap"><div>
      <div class="ja" style="font-size:44px;letter-spacing:.2em;opacity:.9">夕桜</div>
      <div class="en" style="font-size:78px;font-style:italic;font-weight:500;margin-top:6px">Yūzakura</div>
      <div class="en" style="font-size:27px;font-style:italic;margin-top:14px;opacity:.85">An ancient weeping cherry in a garden at dusk</div>
      <div class="en" style="font-size:19px;letter-spacing:.32em;margin-top:44px;opacity:.7">EVERY BRANCH, BLOSSOM AND STONE GROWN FROM CODE</div>
    </div></div>`,
  };
  const fonts = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Shippori+Mincho:wght@600&display=block';
  for (const [name, body] of Object.entries(cards)) {
    await page.setContent(`<html><head><link rel="stylesheet" href="${fonts}"><style>${css}</style></head><body>${body}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(dir, `${name}.png`), omitBackground: true });
  }
  await context.close();
  return dir;
}

async function assemble(titles, score) {
  const H16 = Math.round((W * 9) / 16 / 2) * 2;
  const top = Math.round((H16 - H) / 4) * 2;
  const inputs = [];
  const graph = [];
  SHOTS.forEach((s, i) => {
    inputs.push('-framerate', String(FPS * BLUR), '-i', path.join(WORK, s.name, 'f%04d.png'));
    const blur = BLUR > 1 ? `tmix=frames=${BLUR},select=gte(n\\,${BLUR - 1}),framestep=${BLUR},` : '';
    // Supersampled frames are downscaled here; tpad only matters for test renders.
    graph.push(`[${i}]${blur}scale=${W}:${H}:flags=lanczos+accurate_rnd+full_chroma_int,setsar=1,fps=${FPS},` +
      `tpad=stop_mode=clone:stop_duration=${s.seconds},trim=duration=${s.seconds},format=yuv444p,setpts=PTS-STARTPTS[s${i}]`);
  });
  let prev = 's0', at = 0;
  for (let i = 1; i < SHOTS.length; i++) {
    at += SHOTS[i - 1].seconds - XFADE;
    graph.push(`[${prev}][s${i}]xfade=transition=fade:duration=${XFADE}:offset=${at.toFixed(3)}[x${i}]`);
    prev = `x${i}`;
  }
  const n = SHOTS.length;
  inputs.push('-loop', '1', '-framerate', String(FPS), '-i', path.join(titles, 'open.png'));
  inputs.push('-loop', '1', '-framerate', String(FPS), '-i', path.join(titles, 'close.png'));
  const closeAt = TOTAL - 3.0;
  graph.push(`[${n}]format=rgba,trim=duration=4.4,fade=in:st=1.0:d=1.0:alpha=1,fade=out:st=3.5:d=0.9:alpha=1,setpts=PTS-STARTPTS[t1]`);
  graph.push(`[${n + 1}]format=rgba,trim=duration=3.0,fade=in:st=0:d=1.1:alpha=1,setpts=PTS-STARTPTS+${closeAt.toFixed(3)}/TB[t2]`);
  graph.push(`[${prev}][t1]overlay=0:0:eof_action=pass[v1]`);
  graph.push(`[v1][t2]overlay=0:0:eof_action=pass,fade=in:st=0:d=1.2,fade=out:st=${(TOTAL - 1.4).toFixed(3)}:d=1.4,` +
    `pad=${W}:${H16}:0:${top}:black,format=${HEVC ? 'yuv420p10le' : 'yuv420p'}[out]`);
  const audio = [];
  if (score) {
    inputs.push('-i', score);
    graph.push(`[${n + 2}]atrim=duration=${TOTAL.toFixed(3)},afade=out:st=${(TOTAL - 2.0).toFixed(3)}:d=2.0[aud]`);
    audio.push('-map', '[aud]', '-c:a', 'aac', '-b:a', '320k');
  }
  const video = HEVC
    ? ['-c:v', 'libx265', '-crf', '14', '-preset', 'slow', '-tag:v', 'hvc1', '-x265-params', 'aq-mode=3:no-sao=1']
    : ['-c:v', 'libx264', '-crf', '13', '-preset', 'slow', '-tune', 'film', '-profile:v', 'high'];
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-stats', '-y', ...inputs,
    '-filter_complex', graph.join(';\n'), '-map', '[out]', ...audio,
    '-t', TOTAL.toFixed(3), '-r', String(FPS), ...video, '-movflags', '+faststart', OUT]);
}

// ---- Main ----------------------------------------------------------------------------
if (spawnSync('ffmpeg', ['-version']).status !== 0) {
  console.error('ffmpeg was not found on the PATH.');
  process.exit(1);
}
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
console.log(`Yūzakura film: ${W}×${H} picture, rendered at ${Math.round(W * SS)}×${Math.round(H * SS)}, ` +
  `${FPS} fps${BLUR > 1 ? ` (${BLUR} sub-frames)` : ''}, quality ${QUALITY}, ${TOTAL.toFixed(1)} s`);
console.log(`Frames: ${WORK}`);
if (!opt('headless', false)) {
  console.log('The browser window shows only the top-left corner of each frame, because the frame is\n' +
    'larger than the screen. The captured frames are complete; leave the window alone.');
}

const browser = await launch();
try {
  const started = Date.now();
  for (const shot of SHOTS) {
    if (ONLY && !ONLY.includes(shot.name)) continue;
    await renderShot(browser, port, shot);
  }
  console.log(`Rendered in ${fmtTime((Date.now() - started) / 1000)}.`);
  if (!ONLY) await finish();
} finally {
  await browser.close().catch(() => {});
  server.close();
}

async function finish() {
  const titles = await renderTitles(browser);
  await browser.close();

  let score = path.join(WORK, 'score.wav');
  const py = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(HERE, 'score.py'), score], { stdio: 'inherit' });
  if (py.status !== 0) {
    console.warn('Could not synthesise the score (Python 3 with NumPy is needed); the film will be silent.');
    score = null;
  }
  console.log('Encoding…');
  await assemble(titles, score);
  console.log(`\nDone: ${OUT}`);
}
