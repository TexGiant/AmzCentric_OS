const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2];
const Y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const pages = [
  { id: 'brands', url: '/dashboard', targets: { navy: "document.querySelector('section.bg-navy-800')", cards: "document.querySelector('main a[href^=\"/dashboard/\"]')?.parentElement" } },
  { id: 'overview', url: '/dashboard/harbor-pine', targets: { kpis: "document.querySelector('main .grid')", attention: "card('Attention required')", trend: "card('Performance trend')" } },
  { id: 'changed', url: '/dashboard/harbor-pine/what-changed', targets: { movers: "card('Campaign movers')", gained: "document.querySelectorAll('main .grid')[1]" } },
  { id: 'terms', url: '/dashboard/harbor-pine/search-terms?view=wasted', targets: { wasted: "kpi('Wasted spend')", tabs: "document.querySelector('main section .border-b')" } },
  { id: 'hourly', url: '/dashboard/lumen-labs/hourly?day=' + Y, targets: { funnel: "card('Funnel')", clicks: "card('Clicks & orders')" } },
  { id: 'actions', url: '/dashboard/harbor-pine/actions', targets: { form: "card('Log an action')", history: "card('History')" } },
  { id: 'goals', url: '/dashboard/harbor-pine/goals', targets: { pacing: "kpi('Sales pacing')?.parentElement", chart: "card('Cumulative sales')" } },
];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const meta = {};
  for (const pg of pages) {
    await p.goto('http://localhost:3100' + pg.url, { waitUntil: 'networkidle' });
    await p.waitForTimeout(600);
    // Hide the demo-mode notice and use a neutral team login for the recording.
    await p.evaluate(() => {
      for (const el of document.querySelectorAll('aside div')) if (el.textContent.trim().startsWith('Demo data')) el.style.display = 'none';
      for (const el of document.querySelectorAll('aside span')) if (el.textContent.trim() === 'demo@amzcentric.com') el.textContent = 'team@amzcentric.com';
    });
    const fullH = await p.evaluate(() => document.documentElement.scrollHeight);
    await p.setViewportSize({ width: 1440, height: Math.max(900, fullH) });
    await p.waitForTimeout(400);
    const boxes = await p.evaluate((targets) => {
      const card = (t) => [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent.trim().startsWith(t));
      const kpi = (t) => [...document.querySelectorAll('section')].find((s) => s.firstElementChild?.textContent.trim().startsWith(t));
      const out = {};
      for (const [k, expr] of Object.entries(targets)) {
        const el = eval(expr);
        if (!el) { out[k] = null; continue; }
        const r = el.getBoundingClientRect();
        out[k] = { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
      }
      return { ...out, pageH: document.documentElement.scrollHeight };
    }, pg.targets);
    await p.screenshot({ path: `${OUT}/${pg.id}.png` });
    await p.setViewportSize({ width: 1440, height: 900 });
    meta[pg.id] = { url: pg.url.split('?')[0], ...boxes };
    console.log(pg.id, JSON.stringify(boxes));
  }
  fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 1));
  await b.close();
})();
