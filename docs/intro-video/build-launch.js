// Feature launch video: "Ask Claude about any brand" (AmzCentric OS Claude connector).
// Same rendering approach as build-video.js: CSS animations on one timeline, seeked per frame.
const fs = require('fs');
const path = require('path');
const L = process.argv[2];
const A = JSON.parse(fs.readFileSync(path.join(L, 'shots/answers.json'), 'utf8'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const money = (v) => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let t0 = 0;
let uid = 0;
const css = [];
const html = [];
const anim = (name, dur, delay, ease = 'cubic-bezier(.22,1,.36,1)') => `animation:${name} ${dur}s ${ease} ${delay.toFixed(3)}s both;`;

function scene(dur, inner, cls = '') {
  const id = `v${uid++}`;
  const f = (0.4 / dur) * 100;
  css.push(`@keyframes ${id}{0%{opacity:0}${f.toFixed(3)}%{opacity:1}${(100 - f).toFixed(3)}%{opacity:1}100%{opacity:0}}`);
  html.push(`<section class="scene ${cls}" style="animation:${id} ${dur}s linear ${t0.toFixed(3)}s both">${inner}</section>`);
  t0 += dur;
}

function caption(s, c) {
  let o = `<div class="cap"><div class="eyebrow" style="${anim('up', 0.7, s + 0.2)}">[ ${esc(c.eyebrow)} ]</div><h2 style="${anim('up', 0.8, s + 0.4)}">${esc(c.title)}</h2>`;
  if (c.body) o += `<p class="body" style="${anim('up', 0.8, s + 0.7)}">${esc(c.body)}</p>`;
  return o + `</div>`;
}

/** A chat card: the user's question types in, the tool call runs, the answer appears line by line. */
function chat(s, c) {
  const typeDur = Math.min(2.2, 0.045 * c.q.length);
  const q0 = s + 0.7;
  const tool = q0 + typeDur + 0.4;
  const ans = tool + 1.3;
  const id = `ty${uid++}`;
  css.push(`@keyframes ${id}{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}`);
  let o = `<div class="chat" style="${anim('slide', 0.9, s + 0.1)}">
    <div class="chat-head"><span class="who">Claude</span><span class="conn"><i></i>AmzCentric OS connected</span></div>
    <div class="msgs">
      <div class="user"><span style="animation:${id} ${typeDur}s steps(${c.q.length}) ${q0.toFixed(3)}s both">${esc(c.q)}</span></div>
      <div class="tool" style="${anim('up', 0.5, tool)}"><span class="spin" style="${anim('fadeout', 0.2, tool + 1.0, 'linear')}"></span><span class="done" style="${anim('pop', 0.3, tool + 1.0)}">✓</span>AmzCentric OS · <code>${esc(c.tool)}</code></div>
      <div class="ans">`;
  c.lines.forEach((l, i) => {
    o += `<div class="line ${l.cls || ''}" style="${anim('up', 0.6, ans + i * (c.step ?? 0.75))}">${l.html}</div>`;
  });
  return o + `</div></div></div>`;
}

// ── Data from the demo connector ────────────────────────────────────────
const ch = A.changed;
const [m1, m2, m3] = ch.campaign_movers;
const short = (n) => n.replace(/^SP \| /, '').replace(/ \| /g, ' · ');
const wasted = A.wasted;
const logged = A.logged.entry;

// ── Scenes ─────────────────────────────────────────────────────────────
scene(4.6, `<div class="center">
  <div class="eyebrow" style="${anim('up', 0.7, 0.2)}">[ New in AmzCentric OS ]</div>
  <h1 style="${anim('up', 0.9, 0.5)}">Ask Claude about any brand.</h1>
  <p class="sub" style="${anim('up', 0.8, 1.1)}">The AmzCentric OS connector for Claude: answers from your live data, and actions logged for you.</p>
  <img class="logo" src="logo.png" style="${anim('pop', 0.8, 1.6)}"></div>`, 'hero');

{
  const s = t0;
  scene(13.2, caption(s, { eyebrow: 'Ask', title: 'Why did sales move?', body: 'Claude pulls the movers, the reason behind each one, and the actions your team logged.' }) +
    chat(s, {
      q: 'What changed for Harbor & Pine this week?',
      tool: 'get_what_changed',
      lines: [
        { html: `Ad sales are up <b class="g">+${ch.sales_change_pct.toFixed(1)}%</b> week over week (${money(ch.totals_before.sales)} → ${money(ch.totals_now.sales)}). The three biggest moves:` },
        { cls: 'li', html: `<b>${esc(short(m1.campaign))}</b> <span class="r">${money(m1.sales_change).replace('$-', '−$')}</span>: paused on Nov 10 <span class="tag">logged</span>` },
        { cls: 'li', html: `<b>${esc(short(m2.campaign))}</b> <span class="g">+${money(m2.sales_change)}</span>: more traffic after the +25% top-of-search bid raise on Nov 7 <span class="tag">logged</span>` },
        { cls: 'li', html: `<b>${esc(short(m3.campaign))}</b> <span class="g">+${money(m3.sales_change)}</span>: better conversion, but ACOS is ${m3.acos_now_pct.toFixed(1)}%. Worth a bid check.` },
      ],
    }));
}
{
  const s = t0;
  const rows = wasted.terms.map((t) => `<tr><td>${esc(t.search_term)}</td><td>${t.clicks}</td><td>0</td><td>${money(t.spend)}</td></tr>`).join('');
  scene(11.4, caption(s, { eyebrow: 'Find', title: 'Spot wasted spend in seconds.', body: 'Search terms, campaigns, hourly, goals: every dashboard, in plain English.' }) +
    chat(s, {
      q: 'Show wasted search terms for Harbor & Pine, last 30 days',
      tool: 'get_search_terms',
      step: 0.9,
      lines: [
        { html: `<b>${wasted.terms_matching} search terms</b> had 10+ clicks and no orders, costing <b class="r">${money(wasted.total_spend_matching)}</b>:` },
        { cls: 'tbl', html: `<table><tr><th>Search term</th><th>Clicks</th><th>Orders</th><th>Spend</th></tr>${rows}</table>` },
        { html: `Add them as negative exact? I can log it once you have.` },
      ],
    }));
}
{
  const s = t0;
  scene(11, caption(s, { eyebrow: 'Log it', title: 'Tell Claude what you changed.', body: 'It goes in the Action Log under your name, and the app measures the impact over the next 14 days.' }) +
    chat(s, {
      q: 'Log that I raised exact bids 15% on Bamboo today',
      tool: 'log_action',
      lines: [
        { cls: 'card', html: `<div class="ok">✓ Added to the Action Log</div><div class="kv"><span>Brand</span><b>Harbor &amp; Pine</b><span>Change</span><b>Bid change</b><span>Campaign</span><b>${esc(logged.campaign_name)}</b><span>Date</span><b>Nov 19</b><span>Logged by</span><b>sam@amzcentric.com</b></div>` },
        { html: `I'll be able to show the impact after 3 days; the full result is in after 14.` },
      ],
    }));
}
{
  const s = t0;
  const cards = [
    ['Reads every dashboard', 'Brands, campaigns, search terms, hourly, products, goals and the Action Log.'],
    ['Writes only to the Action Log', 'Every entry carries the name of the person who asked.'],
    ['Can’t change anything in Amazon', 'Bids, budgets and campaigns stay in your hands.'],
  ];
  let inner = `<div class="cap wide"><div class="eyebrow" style="${anim('up', 0.7, s + 0.2)}">[ Built safe ]</div><h2 style="${anim('up', 0.8, s + 0.4)}">Your login. Your access. Nothing more.</h2></div><div class="guards">`;
  cards.forEach(([t, d], i) => (inner += `<div class="guard" style="${anim('up', 0.7, s + 1.1 + i * 0.5)}"><em>${i === 2 ? '✕' : '✓'}</em><b>${t}</b><span>${d}</span></div>`));
  inner += `</div><p class="foot" style="${anim('up', 0.7, s + 3.0)}">Each teammate signs in with their own AmzCentric OS account and can disconnect any time.</p>`;
  scene(7, inner);
}
{
  const s = t0;
  const steps = [
    ['Add the connector', 'A Claude Owner: Organization settings → Connectors → Add custom connector. Paste the URL. Once for the team.'],
    ['Connect', 'Each teammate: Settings → Connectors → Connect next to AmzCentric OS.'],
    ['Sign in and Allow', 'Use your AmzCentric OS login, check what Claude can do, click Allow. Done.'],
  ];
  const at = [s + 1.2, s + 5.6, s + 10.0];
  const dur = 15.4;
  let inner = `<div class="cap"><div class="eyebrow" style="${anim('up', 0.7, s + 0.2)}">[ Set it up ]</div><h2 style="${anim('up', 0.8, s + 0.4)}">Three steps. Two minutes.</h2></div><div class="steps">`;
  steps.forEach(([t, d], i) => {
    const id = `hl${uid++}`;
    const a = ((at[i] - s) / dur) * 100, b = (((at[i + 1] ?? s + dur) - s) / dur) * 100;
    css.push(`@keyframes ${id}{0%,${(a - 0.1).toFixed(2)}%{border-color:rgba(0,15,34,.14);background:#fff}${a.toFixed(2)}%,${(b - 1).toFixed(2)}%{border-color:#f8a42e;background:#fef4e3}${b.toFixed(2)}%,100%{border-color:rgba(0,15,34,.14);background:#fff}}`);
    inner += `<div class="stp" style="${anim('up', 0.6, at[i] - 0.4)}"><div class="stp-in" style="animation:${id} ${dur}s linear ${s.toFixed(3)}s both"><em>${i + 1}</em><div><b>${t}</b><span>${d}</span></div></div></div>`;
  });
  inner += `</div>`;
  // Right-hand visuals, one per step.
  const vis = (i, content) => {
    const id = `vs${uid++}`;
    const a = ((at[i] - s) / dur) * 100, a2 = ((at[i] - s + 0.5) / dur) * 100, e = (((at[i + 1] ?? s + dur + 1) - s - 0.3) / dur) * 100, e2 = (((at[i + 1] ?? s + dur + 1) - s) / dur) * 100;
    css.push(`@keyframes ${id}{0%,${a.toFixed(2)}%{opacity:0;transform:translateY(24px)}${a2.toFixed(2)}%,${Math.min(e, 100).toFixed(2)}%{opacity:1;transform:none}${Math.min(e2, 100).toFixed(2)}%,100%{opacity:${i === 2 ? 1 : 0};transform:none}}`);
    return `<div class="vis" style="animation:${id} ${dur}s linear ${s.toFixed(3)}s both">${content}</div>`;
  };
  inner += vis(0, `<div class="urlcard"><div class="lbl">Connector URL</div><div class="url">https://os.amzcentric.com/api/mcp</div><div class="hint">Name it <b>AmzCentric OS</b>. Pro or Max plan? Each person adds it in their own Settings → Connectors.</div></div>`);
  inner += vis(1, `<div class="urlcard"><div class="row"><div class="ico">A</div><div><b>AmzCentric OS</b><span>Custom connector</span></div><div class="btn">Connect</div></div><div class="hint">Using Claude Code instead? <code>claude mcp add --transport http amzcentric https://os.amzcentric.com/api/mcp</code></div></div>`);
  inner += vis(2, `<img class="consent" src="shots/consent-crop.png">`);
  scene(dur, inner);
}
scene(6.4, `<div class="center">
  <h1 class="big" style="${anim('up', 0.9, t0 + 0.3)}">Available now.</h1>
  <p class="sub" style="${anim('up', 0.8, t0 + 0.9)}">Settings → <b>Claude connector</b> has the URL, the steps and your connections.</p>
  <img class="logo" src="logo.png" style="${anim('pop', 0.8, t0 + 1.5)}"></div>`, 'hero');

const TOTAL = t0;
const doc = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fonts/local.css"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden;background:#fff;font-family:Manrope,sans-serif;color:#334155}
.scene{position:absolute;inset:0;background:#fff}
.scene.hero{background:linear-gradient(180deg,#fff 0%,#fdeeda 52%,#fbb55a 100%)}
.center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 160px}
.logo{height:70px;margin-top:64px}
h1{font:600 92px/1.06 Montserrat;color:#000f22;margin-top:22px;letter-spacing:-.015em}
h1.big{font-size:110px}
.sub{margin-top:26px;font-size:32px;line-height:1.4;color:#334155;font-weight:500;max-width:1300px}
.sub b{color:#000f22}
.eyebrow{font:700 24px Manrope;letter-spacing:.06em;color:#d4830f;text-transform:uppercase}
.cap{position:absolute;left:120px;top:250px;width:560px}
.cap.wide{top:150px;width:1680px}
h2{font:600 58px/1.1 Montserrat;color:#000f22;margin-top:18px;letter-spacing:-.01em}
.body{font-size:27px;line-height:1.5;margin-top:26px;color:#475569}
.chat{position:absolute;left:760px;top:170px;width:1040px;min-height:620px;border-radius:24px;background:#fff;box-shadow:0 30px 80px rgba(0,15,34,.18),0 0 0 1px rgba(0,15,34,.1);overflow:hidden}
.chat-head{height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 30px;border-bottom:1px solid rgba(0,15,34,.08);background:#f8fafc}
.who{font:700 22px Montserrat;color:#000f22}
.conn{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:700;color:#166534;background:#dcfce7;padding:6px 14px;border-radius:999px}
.conn i{width:9px;height:9px;border-radius:50%;background:#16a34a}
.msgs{padding:34px 36px;display:flex;flex-direction:column;gap:22px}
.user{align-self:flex-end;max-width:860px;background:#000f22;color:#fff;font-size:25px;font-weight:600;padding:18px 24px;border-radius:20px 20px 6px 20px;white-space:nowrap}
.tool{align-self:flex-start;display:flex;align-items:center;gap:12px;font-size:19px;font-weight:700;color:#475569;border:1.5px solid rgba(0,15,34,.16);border-radius:12px;padding:10px 16px;position:relative}
.tool code{font:600 18px ui-monospace,Menlo,monospace;color:#b06a0c;background:#fef4e3;padding:2px 8px;border-radius:6px}
.spin{width:18px;height:18px;border-radius:50%;border:3px solid #fde2b8;border-top-color:#f8a42e;position:absolute;left:16px;animation:none}
.done{width:22px;height:22px;border-radius:50%;background:#16a34a;color:#fff;font-size:14px;display:grid;place-items:center}
.ans{display:flex;flex-direction:column;gap:16px;font-size:24px;line-height:1.5;color:#1f2937}
.ans b{color:#000f22}.g{color:#16a34a;font-weight:700}.r{color:#dc2626;font-weight:700}
.line.li{padding-left:26px;position:relative}.line.li::before{content:"";position:absolute;left:4px;top:15px;width:9px;height:9px;border-radius:50%;background:#f8a42e}
.tag{font-size:16px;font-weight:700;color:#b06a0c;background:#fef4e3;padding:3px 10px;border-radius:999px;margin-left:6px;vertical-align:2px}
table{border-collapse:collapse;width:100%;font-size:21px}
th{text-align:left;font-size:15px;letter-spacing:.12em;text-transform:uppercase;color:#64748b;padding:10px 14px;background:#f8fafc;border-bottom:1px solid rgba(0,15,34,.1)}
td{padding:12px 14px;border-bottom:1px solid rgba(0,15,34,.08);font-variant-numeric:tabular-nums}
th:not(:first-child),td:not(:first-child){text-align:right}
td:last-child{color:#dc2626;font-weight:700}
.line.card{border:1.5px solid rgba(22,163,74,.4);background:#f0fdf4;border-radius:18px;padding:22px 26px}
.ok{font:700 25px Montserrat;color:#166534}
.kv{display:grid;grid-template-columns:150px 1fr;gap:8px 18px;margin-top:14px;font-size:21px}.kv span{color:#64748b}
.guards{position:absolute;left:120px;top:400px;width:1680px;display:grid;grid-template-columns:repeat(3,1fr);gap:32px}
.guard{border:1px solid rgba(0,15,34,.16);border-radius:22px;padding:36px 34px;box-shadow:0 2px 6px rgba(0,15,34,.07)}
.guard em{display:grid;place-items:center;width:52px;height:52px;border-radius:14px;background:#fef4e3;color:#d4830f;font:700 28px Manrope;font-style:normal}
.guard:nth-child(3) em{background:#fee2e2;color:#dc2626}
.guard b{display:block;font:700 31px/1.2 Montserrat;color:#000f22;margin-top:22px}.guard span{display:block;font-size:23px;line-height:1.45;margin-top:12px;color:#475569}
.foot{position:absolute;left:120px;right:120px;top:780px;text-align:center;font-size:28px;font-weight:600;color:#334155}
.steps{position:absolute;left:120px;top:440px;width:640px;display:flex;flex-direction:column;gap:20px}
.stp-in{display:flex;gap:20px;align-items:flex-start;border:2px solid rgba(0,15,34,.14);border-radius:20px;padding:22px 24px}
.stp-in em{flex:none;width:44px;height:44px;border-radius:50%;background:#000f22;color:#fff;display:grid;place-items:center;font:700 21px Montserrat;font-style:normal}
.stp-in b{display:block;font:700 26px Montserrat;color:#000f22}.stp-in span{display:block;font-size:20px;line-height:1.45;margin-top:6px;color:#475569}
.vis{position:absolute;left:880px;top:200px;width:920px;height:700px;display:flex;align-items:center;justify-content:center}
.urlcard{width:900px;border-radius:24px;background:#fff;box-shadow:0 30px 80px rgba(0,15,34,.18),0 0 0 1px rgba(0,15,34,.1);padding:44px}
.urlcard .lbl{font-size:20px;font-weight:700;color:#64748b;letter-spacing:.04em}
.urlcard .url{margin-top:14px;font:600 36px ui-monospace,Menlo,monospace;color:#000f22;background:#fef4e3;border:2px solid #f8a42e;border-radius:14px;padding:22px 24px}
.urlcard .hint{margin-top:24px;font-size:22px;line-height:1.5;color:#475569}.urlcard .hint code{font-size:17px;background:#f1f5f9;padding:3px 8px;border-radius:6px;color:#000f22}
.urlcard .row{display:flex;align-items:center;gap:20px;border:1px solid rgba(0,15,34,.12);border-radius:18px;padding:22px}
.urlcard .ico{width:60px;height:60px;border-radius:14px;background:#000f22;color:#f8a42e;display:grid;place-items:center;font:800 32px Montserrat}
.urlcard .row b{display:block;font:700 28px Montserrat;color:#000f22}.urlcard .row span{display:block;font-size:19px;color:#64748b;margin-top:4px}
.urlcard .btn{margin-left:auto;background:#000f22;color:#fff;font-weight:700;font-size:21px;padding:14px 26px;border-radius:999px}
.consent{width:640px;border-radius:24px;box-shadow:0 30px 80px rgba(0,15,34,.2)}
.progress{position:absolute;left:0;bottom:0;height:6px;width:100%;background:#f8a42e;transform-origin:0 50%;animation:prog ${TOTAL}s linear 0s both;z-index:10}
@keyframes prog{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes up{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
@keyframes pop{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}
@keyframes slide{from{opacity:0;transform:translateX(70px)}to{opacity:1;transform:none}}
@keyframes fadeout{from{opacity:1}to{opacity:0}}
@keyframes spinr{to{transform:rotate(360deg)}}
${css.join('\n')}
</style></head><body>${html.join('\n')}<div class="progress"></div>
<script>window.TOTAL=${TOTAL};window.seek=t=>{for(const a of document.getAnimations()){a.pause();a.currentTime=t*1000}};</script></body></html>`;
fs.writeFileSync(path.join(L, 'index.html'), doc);
console.log('total seconds', TOTAL.toFixed(1));
