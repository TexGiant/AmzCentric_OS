// Builds the HR video SOP (1920x1080 HTML, CSS animations on one timeline), same look as
// the intro video. Screenshots from capture-hr.js; render-video.js seeks it frame by frame.
const fs = require('fs');
const path = require('path');
const V = process.argv[2];
const meta = JSON.parse(fs.readFileSync(path.join(V, 'shots/meta.json'), 'utf8'));

const FRAME = { x: 800, y: 178, w: 1010, chrome: 42 };
const S = FRAME.w / 1440; // screenshot css px → video px
const VIEW_H = 640; // visible content height in video px
const VIEW_CSS = VIEW_H / S;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
let t0 = 0;
const css = [];
const html = [];
let uid = 0;
const anim = (name, dur, delay, extra = '') => `animation:${name} ${dur}s cubic-bezier(.22,1,.36,1) ${delay.toFixed(3)}s both;${extra}`;

function sceneShell(dur, inner, bg = '') {
  const id = `s${uid++}`;
  const f = (0.45 / dur) * 100;
  css.push(`@keyframes v${id}{0%{opacity:0}${f.toFixed(3)}%{opacity:1}${(100 - f).toFixed(3)}%{opacity:1}100%{opacity:0}}`);
  html.push(`<section class="scene ${bg}" style="animation:v${id} ${dur}s linear ${t0.toFixed(3)}s both">${inner}</section>`);
  t0 += dur;
}

function caption(start, c) {
  let out = `<div class="cap">`;
  out += `<div class="eyebrow" style="${anim('up', 0.7, start + 0.25)}">[ ${esc(c.eyebrow)} ]</div>`;
  out += `<h2 style="${anim('up', 0.8, start + 0.45)}">${esc(c.title)}</h2>`;
  if (c.body) out += `<p class="body" style="${anim('up', 0.8, start + 0.7)}">${esc(c.body)}</p>`;
  (c.bullets || []).forEach((b, i) => {
    out += `<div class="bullet" style="${anim('up', 0.7, start + 1.2 + i * 0.45)}"><span class="tick"></span><span>${esc(b)}</span></div>`;
  });
  return out + `</div>`;
}

function appScene(dur, c) {
  const start = t0;
  const m = meta[c.shot];
  const maxScroll = Math.max(0, m.pageH - VIEW_CSS);
  const center = (b) => Math.min(maxScroll, Math.max(0, b.y + b.h / 2 - VIEW_CSS / 2));
  // Scroll keyframes: hold, then glide to each spotlight that needs it.
  const id = `sc${uid++}`;
  const stops = [{ t: 0, y: 0 }];
  for (const sp of c.spots) {
    const y = sp.noScroll ? stops.at(-1).y : center(m[sp.target]);
    if (y !== stops.at(-1).y) stops.push({ t: sp.at - 0.9, y: stops.at(-1).y }, { t: sp.at - 0.1, y });
  }
  stops.push({ t: dur, y: stops.at(-1).y });
  const kf = stops.map((s) => `${((s.t / dur) * 100).toFixed(3)}%{transform:translateY(${(-s.y * S).toFixed(1)}px)}`).join('');
  css.push(`@keyframes ${id}{${kf}}`);
  let spots = '';
  c.spots.forEach((sp, i) => {
    const b = m[sp.target];
    if (!b) throw new Error(`missing target ${c.shot}.${sp.target}`);
    const until = c.spots[i + 1]?.at ?? dur - 0.2;
    const sid = `sp${uid++}`;
    const a = (sp.at / dur) * 100, a2 = ((sp.at + 0.5) / dur) * 100, z = ((until - 0.3) / dur) * 100, z2 = (until / dur) * 100;
    css.push(`@keyframes ${sid}{0%,${a.toFixed(3)}%{opacity:0;transform:scale(1.04)}${a2.toFixed(3)}%,${z.toFixed(3)}%{opacity:1;transform:scale(1)}${z2.toFixed(3)}%,100%{opacity:0;transform:scale(1)}}`);
    const pad = 8;
    spots += `<div class="spot" style="left:${(b.x * S - pad).toFixed(1)}px;top:${(b.y * S - pad).toFixed(1)}px;width:${(b.w * S + pad * 2).toFixed(1)}px;height:${(b.h * S + pad * 2).toFixed(1)}px;animation:${sid} ${dur}s linear ${start.toFixed(3)}s both"></div>`;
  });
  const frame = `<div class="frame" style="${anim('slide', 0.9, start + 0.15)}">
    <div class="chrome"><i></i><i></i><i></i><div class="url">os.amzcentric.com${esc(m.url)}</div></div>
    <div class="view"><div class="page" style="animation:${id} ${dur}s linear ${start.toFixed(3)}s both">
      <img src="shots/${c.shot}.png" style="width:${FRAME.w}px">${spots}</div></div></div>`;
  sceneShell(dur, caption(start, c) + frame + `<div class="step">${esc(c.step)}</div>`);
}

// ── Scenes ──────────────────────────────────────────────────────────────
sceneShell(5.4, `<div class="center">
  <img class="logo-xl" src="logo.png" style="${anim('pop', 1, 0.2)}">
  <div class="os-chip" style="${anim('pop', 0.8, 0.7)}">OS</div>
  <h1 style="${anim('up', 0.9, 1.1)}">Check-in, leave and attendance</h1>
  <p class="sub" style="${anim('up', 0.9, 1.6)}">HR in AmzCentric OS · a 90-second guide for the team</p></div>`, 'hero');

{
  const s = t0;
  const src = [
    ['Fingerprint machine', 'Office days: first punch in, last punch out', 'Every 5 min'],
    ['My Day check-in', 'Working from home: check in and out in the app', 'WFH days'],
    ['Active minutes', 'Time you’re active in the app, per brand', 'Live'],
  ];
  let inner = `<div class="cap wide"><div class="eyebrow" style="${anim('up', 0.7, s + 0.2)}">[ How it works ]</div>
    <h2 style="${anim('up', 0.8, s + 0.4)}">No more WhatsApp requests or Google Sheets.</h2></div><div class="flow">`;
  src.forEach(([n, d, tag], i) => {
    inner += `<div class="src" style="${anim('slideR', 0.8, s + 1.1 + i * 0.5)}"><b>${n}</b><span>${d}</span><em>${tag}</em></div>`;
  });
  inner += `<svg class="wires" viewBox="0 0 300 420" style="${anim('fade', 0.8, s + 2.6)}"><path d="M0 70 C150 70 150 210 300 210"/><path d="M0 210 H300"/><path d="M0 350 C150 350 150 210 300 210"/></svg>`;
  inner += `<div class="hub" style="${anim('pop', 0.9, s + 3.2)}"><img src="logo.png"><div class="os-chip sm">OS</div><span>One record of attendance, leave and time.</span></div></div>`;
  sceneShell(8.2, inner);
}

appScene(9.2, {
  shot: 'checkin', step: '01 / 06', eyebrow: 'Every morning', title: 'Check in for today.',
  body: 'The bar at the top of the app asks until you’re checked in.',
  bullets: ['At the office: punch the fingerprint machine. That’s it.', 'From home: press Working from home, then Check out when you finish', 'Forgot to punch? Press I’m at the office'],
  spots: [{ target: 'banner', at: 2.0 }],
});
appScene(10.4, {
  shot: 'me', step: '02 / 06', eyebrow: 'Leave & WFH', title: 'Ask in the app.',
  body: 'My Day → Request leave or WFH.',
  bullets: ['Pick the type and dates; leave the last day empty for one day', 'Half day: pick AM or PM', 'Track it under My requests; cancel while it’s waiting'],
  spots: [{ target: 'form', at: 2.0 }, { target: 'requests', at: 6.6 }],
});

{
  const s = t0;
  const rules = [
    ['Sick', '8', 'a year', 'Same day is fine'],
    ['Casual', '6', 'a year', '1 day’s notice'],
    ['Annual', '12', 'a year', '3 days’ notice'],
    ['Half day', '2', 'a year', 'AM or PM'],
    ['Work from home', '2', 'a month', 'Resets on the 1st'],
  ];
  let inner = `<div class="cap wide"><div class="eyebrow" style="${anim('up', 0.7, s + 0.2)}">[ The leave policy ]</div>
    <h2 style="${anim('up', 0.8, s + 0.4)}">Same rules as the old sheet.</h2></div><div class="pol">`;
  rules.forEach(([n, num, per, note], i) => {
    inner += `<div class="rule" style="${anim('up', 0.7, s + 1.2 + i * 0.4)}"><b>${n}</b><strong>${num}</strong><em>${per}</em><span>${note}</span></div>`;
  });
  inner += `</div><p class="pfoot" style="${anim('up', 0.8, s + 3.8)}">Weekends and holidays don’t use leave. Sick leave over 2 days: HR may ask for a medical note.</p>`;
  sceneShell(9.0, inner);
}

{
  const s = t0;
  const steps = [
    ['Request', 'From My Day, or a WFH check-in'],
    ['Policy check', 'Notice, balance, overlaps'],
    ['HR approves', 'When it fits every rule'],
    ['Zain decides', 'Anything outside the policy'],
  ];
  let inner = `<div class="cap wide dark"><div class="eyebrow" style="${anim('up', 0.7, s + 0.2)}">[ Who approves ]</div>
    <h2 style="${anim('up', 0.8, s + 0.4)}">Within policy, HR approves. Otherwise, Zain decides.</h2></div><div class="loop">`;
  steps.forEach(([n, d], i) => {
    inner += `<div class="lstep${i === 2 ? ' hot' : ''}" style="${anim('up', 0.7, s + 1.4 + i * 0.9)}"><em>${i + 1}</em><b>${n}</b><span>${d}</span></div>`;
    if (i < 3) inner += `<div class="arrow" style="${anim('fade', 0.5, s + 1.9 + i * 0.9)}">${i === 2 ? 'or' : '→'}</div>`;
  });
  inner += `</div><p class="foot" style="${anim('up', 0.8, s + 5.6)}">Only Zain declines. You see every status on My Day.</p>`;
  sceneShell(10, inner, 'navy');
}

appScene(9.6, {
  shot: 'me', step: '03 / 06', eyebrow: 'My Day', title: 'Your balance, your days.',
  body: 'Everything about you, in one place.',
  bullets: ['Leave left this year, WFH left this month', 'Your office days, WFH and late arrivals', 'App time = active minutes in the app only. No screenshots, no keystrokes.'],
  spots: [{ target: 'kpis', at: 2.0 }, { target: 'balance', at: 5.4 }],
});
appScene(9.4, {
  shot: 'hrday', step: '04 / 06', eyebrow: 'Admins · HR page', title: 'The whole team at a glance.',
  body: 'Who’s in the office, at home, on leave, late or absent.',
  bullets: ['First in and last out from the fingerprint machine', 'Needs a look: missed punch-outs, WFH not approved yet'],
  spots: [{ target: 'kpis', at: 2.0 }, { target: 'table', at: 5.6 }],
});
appScene(9.0, {
  shot: 'hrleave', step: '05 / 06', eyebrow: 'Admins · Leave requests', title: 'Decide what HR sends you.',
  body: 'Each request shows why it’s outside the policy.',
  bullets: ['Waiting for you: escalated by HR, with the reason', 'Approve or decline, with a note'],
  spots: [{ target: 'forYou', at: 2.0 }, { target: 'forHr', at: 5.6 }],
});
appScene(9.6, {
  shot: 'hrsettings', step: '06 / 06', eyebrow: 'Admins · Settings → HR', title: 'Set it up once.',
  body: 'The HR bot follows whatever is set here.',
  bullets: ['Office hours, working days, holidays, allowances', 'Each person’s Machine ID and leave already taken this year', 'Last punch received shows the machine is connected'],
  spots: [{ target: 'policy', at: 2.0 }, { target: 'machine', at: 6.0 }],
});

sceneShell(6.6, `<div class="center">
  <h1 class="big" style="${anim('up', 0.9, t0 + 0.3)}">Check in. Ask in the app. <span class="gold">Done.</span></h1>
  <img class="logo-l" src="logo.png" style="${anim('pop', 0.9, t0 + 1.2)}">
  <p class="sub" style="${anim('up', 0.8, t0 + 1.8)}">os.amzcentric.com → My Day · Full guide: “AmzCentric OS — Team SOP” → Attendance &amp; leave</p></div>`, 'hero');

const TOTAL = t0;
css.push(`@keyframes prog{from{transform:scaleX(0)}to{transform:scaleX(1)}}`);
const doc = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fonts/local.css"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden;background:#fff;font-family:Manrope,sans-serif;color:#334155}
.scene{position:absolute;inset:0;background:#fff}
.scene.hero{background:linear-gradient(180deg,#fff 0%,#fdeeda 52%,#fbb55a 100%)}
.scene.navy{background:#000f22;color:#c4cedb}
.center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.logo-xl{height:132px}.logo-l{height:84px;margin-top:56px}
.os-chip{margin-top:22px;background:#000f22;color:#fff;font:700 26px Montserrat;letter-spacing:.12em;padding:8px 18px;border-radius:8px}
.os-chip.sm{font-size:15px;padding:5px 10px;margin:12px 0 0}
h1{font:600 64px/1.1 Montserrat;color:#000f22;margin-top:56px;letter-spacing:-.01em}
h1.big{font-size:84px;max-width:1500px;margin:0}
.gold{color:#d4830f}
.sub{margin-top:22px;font-size:30px;color:#475569;font-weight:500}
.cap{position:absolute;left:120px;top:210px;width:600px}
.cap.wide{top:120px;width:1680px}
.eyebrow{font:700 22px Manrope;letter-spacing:.06em;color:#d4830f;text-transform:uppercase}
.dark .eyebrow{color:#f8a42e}
h2{font:600 60px/1.1 Montserrat;color:#000f22;margin-top:18px;letter-spacing:-.01em}
.dark h2{color:#fff}
.body{font-size:27px;line-height:1.5;margin-top:26px;color:#475569}
.bullet{display:flex;gap:16px;align-items:flex-start;font-size:24px;line-height:1.45;margin-top:22px;color:#1f2937;font-weight:600}
.tick{flex:none;width:28px;height:28px;border-radius:50%;background:#fef4e3;margin-top:3px;position:relative}
.tick::after{content:"";position:absolute;left:9px;top:6px;width:7px;height:12px;border:solid #d4830f;border-width:0 3px 3px 0;transform:rotate(45deg)}
.frame{position:absolute;left:${FRAME.x}px;top:${FRAME.y}px;width:${FRAME.w}px;border-radius:18px;overflow:hidden;box-shadow:0 30px 80px rgba(0,15,34,.22),0 0 0 1px rgba(0,15,34,.12);background:#fff}
.chrome{height:${FRAME.chrome}px;background:#f1f5f9;display:flex;align-items:center;gap:8px;padding:0 16px;border-bottom:1px solid rgba(0,15,34,.1)}
.chrome i{width:12px;height:12px;border-radius:50%;background:#cbd5e1}
.url{margin-left:18px;flex:1;max-width:560px;height:26px;border-radius:999px;background:#fff;font-size:14px;line-height:26px;padding:0 14px;color:#64748b;border:1px solid rgba(0,15,34,.1)}
.view{height:${VIEW_H}px;overflow:hidden;position:relative}
.page{position:relative}.page img{display:block}
.spot{position:absolute;border:3px solid #f8a42e;border-radius:16px;box-shadow:0 0 0 4000px rgba(0,15,34,.34),0 0 30px rgba(248,164,46,.6)}
.step{position:absolute;left:120px;bottom:84px;font:700 18px Manrope;letter-spacing:.14em;color:#94a3b8}
.flow{position:absolute;left:120px;top:360px;width:1680px;height:440px}
.src{position:absolute;left:0;width:560px;height:120px;border:1px solid rgba(0,15,34,.16);border-radius:18px;padding:22px 26px;box-shadow:0 2px 6px rgba(0,15,34,.07);background:#fff}
.src:nth-child(1){top:0}.src:nth-child(2){top:150px}.src:nth-child(3){top:300px}
.src b{display:block;font:700 26px Montserrat;color:#000f22}.src span{display:block;font-size:20px;margin-top:8px;color:#475569}
.src em{position:absolute;right:22px;top:22px;font-style:normal;font-weight:700;font-size:16px;background:#fef4e3;color:#b06a0c;padding:5px 12px;border-radius:999px}
.src.soon{opacity:.75}.src.soon em{background:#f1f5f9;color:#475569}
.wires{position:absolute;left:580px;top:-10px;width:300px;height:440px;overflow:visible}
.wires path{fill:none;stroke:#f8a42e;stroke-width:4}.wires .dash{stroke:#cbd5e1;stroke-dasharray:10 10}
.hub{position:absolute;left:900px;top:80px;width:620px;height:260px;border-radius:26px;background:#000f22;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 30px 70px rgba(0,15,34,.3)}
.hub img{height:58px;filter:brightness(0) invert(1)}
.hub span{margin-top:20px;font-size:22px;color:#c4cedb;font-weight:600}
.loop{position:absolute;left:120px;top:380px;width:1680px;display:flex;align-items:stretch;gap:0}
.lstep{flex:1;border-radius:20px;background:#081a2e;border:1px solid rgba(255,255,255,.12);padding:28px 26px;min-height:200px}
.lstep em{font:700 20px Montserrat;font-style:normal;color:#f8a42e}
.lstep b{display:block;font:700 34px Montserrat;color:#fff;margin-top:14px}
.lstep span{display:block;font-size:21px;line-height:1.4;margin-top:12px;color:#c4cedb}
.lstep.hot{background:#f8a42e;border-color:#f8a42e}.lstep.hot em,.lstep.hot b,.lstep.hot span{color:#000814}
.arrow{width:56px;display:flex;align-items:center;justify-content:center;font-size:36px;color:#7c93b3}
.back{position:absolute;left:120px;top:620px;width:1680px;height:70px}
.backline{position:absolute;left:150px;right:150px;top:0;height:46px;border:3px solid #2d527e;border-top:0;border-radius:0 0 18px 18px}
.back span{position:absolute;left:0;right:0;top:60px;text-align:center;font-size:22px;color:#8da0b8;font-weight:600}
.foot{position:absolute;left:120px;right:120px;top:820px;text-align:center;font:600 40px Montserrat;color:#fff}
.tips{position:absolute;left:120px;top:340px;width:1680px;display:grid;grid-template-columns:1fr 1fr;gap:28px}
.tip{border:1px solid rgba(0,15,34,.16);border-radius:20px;padding:32px 34px;box-shadow:0 2px 6px rgba(0,15,34,.07);border-left:6px solid #f8a42e}
.tip b{display:block;font:700 30px Montserrat;color:#000f22}.tip span{display:block;font-size:24px;line-height:1.45;margin-top:12px;color:#475569}
.pol{position:absolute;left:120px;top:360px;width:1680px;display:grid;grid-template-columns:repeat(5,1fr);gap:24px}
.rule{border:1px solid rgba(0,15,34,.16);border-radius:20px;padding:30px 28px;box-shadow:0 2px 6px rgba(0,15,34,.07);border-top:6px solid #f8a42e}
.rule b{display:block;font:700 26px Montserrat;color:#000f22}
.rule strong{display:inline-block;font:700 76px/1 Montserrat;color:#000f22;margin-top:22px}
.rule em{font-style:normal;font-size:22px;color:#64748b;margin-left:10px;font-weight:600}
.rule span{display:block;font-size:22px;margin-top:18px;color:#475569;font-weight:600}
.pfoot{position:absolute;left:120px;right:120px;top:720px;font-size:26px;color:#475569;font-weight:600}
.progress{position:absolute;left:0;bottom:0;height:6px;width:100%;background:#f8a42e;transform-origin:0 50%;animation:prog ${TOTAL}s linear 0s both;z-index:10}
@keyframes up{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes pop{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}
@keyframes slide{from{opacity:0;transform:translateX(70px)}to{opacity:1;transform:none}}
@keyframes slideR{from{opacity:0;transform:translateX(-50px)}to{opacity:1;transform:none}}
${css.join('\n')}
</style></head><body>${html.join('\n')}<div class="progress"></div>
<script>window.TOTAL=${TOTAL};window.seek=t=>{for(const a of document.getAnimations()){a.pause();a.currentTime=t*1000}};</script></body></html>`;
fs.writeFileSync(path.join(V, 'index.html'), doc);
console.log('total seconds', TOTAL.toFixed(1));
