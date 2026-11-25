// Screenshots + spotlight boxes for the HR video SOP, from the app in demo mode on :3100.
// node docs/intro-video/capture-hr.js <out dir>
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2];
const BASE = 'http://localhost:3100';

const card = "(t) => [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent.trim().startsWith(t))";
const pages = [
  // Ali's dashboard before checking in (machine ID cleared for this shot so no punch matches)
  { id: 'checkin', user: 'demo-ppc', url: '/dashboard/harbor-pine', targets: { banner: "[...document.querySelectorAll('main div')].find((d) => d.className.includes('bg-brand-soft') && d.textContent.includes('Check in for today'))" } },
  { id: 'me', user: 'demo-ppc', url: '/me', targets: { kpis: "document.querySelector('main .grid')", form: "card('Request leave or WFH')", balance: "card('Leave balance')", requests: "card('My requests')", attendance: "card('My attendance')" } },
  { id: 'hrday', user: 'demo-admin', url: '/hr', targets: { kpis: "document.querySelector('main .grid')", table: "card('Today')" } },
  { id: 'hrleave', user: 'demo-admin', url: '/hr?tab=leave', targets: { forYou: "card('Waiting for you')", forHr: "card('Waiting for HR')" } },
  { id: 'hrsettings', user: 'demo-admin', url: '/settings/hr', targets: { policy: "card('Policy')", people: "card('People')", machine: "card('Fingerprint machine')" } },
];

async function setMachineId(b, email, id) {
  const ctx = await b.newContext();
  await ctx.addCookies([{ name: 'amz_demo_user', value: 'demo-admin', url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(BASE + '/settings/hr', { waitUntil: 'networkidle' });
  const form = p.locator('form', { has: p.locator(`input[name=email][value="${email}"]`) });
  await form.locator('input[name=device_user_id]').fill(id);
  await form.locator('button:has-text("Save")').click();
  await form.locator('text=Saved.').waitFor({ timeout: 15000 });
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();
  const meta = {};
  for (const pg of pages) {
    if (pg.id === 'checkin') await setMachineId(b, 'ali@amzcentric.com', '');
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: 'amz_demo_user', value: pg.user, url: BASE }]);
    const p = await ctx.newPage();
    await p.goto(BASE + pg.url, { waitUntil: 'networkidle' });
    await p.waitForTimeout(600);
    // Hide demo-only chrome: the demo notice, the dev "view as" switcher, demo footnotes.
    await p.evaluate(() => {
      for (const el of document.querySelectorAll('aside div')) if (el.textContent.trim().startsWith('Demo data')) el.style.display = 'none';
      for (const el of document.querySelectorAll('aside form')) if (el.textContent.includes('Dev')) el.style.display = 'none';
      for (const el of document.querySelectorAll('main p')) if (el.textContent.startsWith('Demo mode')) el.style.display = 'none';
      for (const el of document.querySelectorAll('aside span')) if (el.textContent.trim() === 'demo@amzcentric.com') el.textContent = 'zain@amzcentric.com';
    });
    const fullH = await p.evaluate(() => document.documentElement.scrollHeight);
    await p.setViewportSize({ width: 1440, height: Math.max(900, fullH) });
    await p.waitForTimeout(400);
    const boxes = await p.evaluate(
      ({ targets, cardSrc }) => {
        const card = eval(cardSrc);
        void card;
        const out = {};
        for (const [k, expr] of Object.entries(targets)) {
          const el = eval(expr);
          if (!el) {
            out[k] = null;
            continue;
          }
          const r = el.getBoundingClientRect();
          out[k] = { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
        }
        return { ...out, pageH: document.documentElement.scrollHeight };
      },
      { targets: pg.targets, cardSrc: card },
    );
    await p.screenshot({ path: `${OUT}/${pg.id}.png` });
    meta[pg.id] = { url: pg.url.split('?')[0], ...boxes };
    console.log(pg.id, JSON.stringify(boxes));
    await ctx.close();
    if (pg.id === 'checkin') await setMachineId(b, 'ali@amzcentric.com', '102');
  }
  fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 1));
  await b.close();
})();
