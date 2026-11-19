// Connects to the local demo connector like Claude would, records real tool answers,
// and screenshots the consent screen + Settings → Claude connector for the launch video.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const SDK = '/home/user/amzcentric-os/node_modules/@modelcontextprotocol/sdk/dist/esm';
const { Client } = await import(`${SDK}/client/index.js`);
const { StreamableHTTPClientTransport } = await import(`${SDK}/client/streamableHttp.js`);
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.argv[2];
const B = 'http://localhost:3100';
const REDIRECT = 'http://localhost:8765/callback';
let clientInfo, tokens, verifier, authUrl;
const provider = {
  get redirectUrl() { return REDIRECT; },
  get clientMetadata() { return { client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }; },
  clientInformation: () => clientInfo, saveClientInformation: (i) => { clientInfo = i; },
  tokens: () => tokens, saveTokens: (t) => { tokens = t; },
  redirectToAuthorization: (u) => { authUrl = u; }, saveCodeVerifier: (v) => { verifier = v; }, codeVerifier: () => verifier,
};
const mk = () => new StreamableHTTPClientTransport(new URL(`${B}/api/mcp`), { authProvider: provider });
try { await new Client({ name: 'x', version: '1' }).connect(mk()); } catch {}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 860 }, deviceScaleFactor: 2 });
const relabel = () => page.evaluate(() => {
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) walk.currentNode.nodeValue = walk.currentNode.nodeValue.replace('demo@amzcentric.com', 'sam@amzcentric.com').replace('http://localhost:3100', 'https://os.amzcentric.com');
  for (const el of document.querySelectorAll('aside div')) if (el.textContent.trim().startsWith('Demo data')) el.style.display = 'none';
});
let callback;
await page.route('http://localhost:8765/**', (r) => { callback = new URL(r.request().url()); r.fulfill({ status: 200, body: 'ok' }); });
await page.goto(authUrl.toString(), { waitUntil: 'networkidle' });
await relabel();
await page.screenshot({ path: `${OUT}/consent.png` });
await page.click('button[value=allow]');
await page.waitForTimeout(1200);
await mk().finishAuth(callback.searchParams.get('code'));

const client = new Client({ name: 'x', version: '1' });
await client.connect(mk());
const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
const data = {
  changed: await call('get_what_changed', { brand: 'harbor-pine' }),
  wasted: await call('get_search_terms', { brand: 'harbor-pine', view: 'wasted' }),
  logged: await call('log_action', { brand: 'harbor-pine', category: 'bid', description: 'Raised exact bids +15% on top 5 keywords', campaign: 'Exact | Bamboo' }),
};
fs.writeFileSync(`${OUT}/answers.json`, JSON.stringify(data, null, 1));

const p2 = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await p2.goto(`${B}/settings/claude`, { waitUntil: 'networkidle' });
await p2.evaluate(() => {
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) walk.currentNode.nodeValue = walk.currentNode.nodeValue.replaceAll('demo@amzcentric.com', 'sam@amzcentric.com').replaceAll('http://localhost:3100', 'https://os.amzcentric.com');
  for (const el of document.querySelectorAll('aside div')) if (el.textContent.trim().startsWith('Demo data')) el.style.display = 'none';
});
const h = await p2.evaluate(() => document.documentElement.scrollHeight);
await p2.setViewportSize({ width: 1440, height: h });
await p2.screenshot({ path: `${OUT}/settings-claude.png` });
const box = await p2.evaluate(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const sec = (t) => [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent.startsWith(t));
  return { connect: r(sec('Connect')), tools: r(sec('What Claude')), conns: r(sec('Active connections')), pageH: document.documentElement.scrollHeight };
});
fs.writeFileSync(`${OUT}/settings-claude.json`, JSON.stringify(box));
await browser.close();
console.log(JSON.stringify({ movers: data.changed.campaign_movers.slice(0, 3), totals: { now: data.changed.totals_now.sales, before: data.changed.totals_before.sales, chg: data.changed.sales_change_pct }, wasted: { n: data.wasted.terms_matching, spend: data.wasted.total_spend_matching, terms: data.wasted.terms.map((t) => [t.search_term, t.clicks, t.spend]) }, logged: data.logged.entry, box }, null, 1));
process.exit(0);
