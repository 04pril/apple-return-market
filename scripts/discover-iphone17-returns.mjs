import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const targets = [
  ['17 Pro 256 Silver','9024167576','26462330287','93437609640'],
  ['17 Pro 256 Deep Blue','9024167576','26462330288','93437609644'],
  ['17 Pro 256 Cosmic Orange','9024167576','26462330290','93437609641'],
  ['17 Pro 512 Silver','9024167576','26462330292','93437609653'],
  ['17 Pro 512 Deep Blue','9024167576','26462330295','93437609654'],
  ['17 Pro 512 Cosmic Orange','9024167576','26462330294','93437609643'],
  ['17 Pro 1TB Silver','9024167576','26462330301','93437609649'],
  ['17 Pro 1TB Deep Blue','9024167576','26462330305','93437609646'],
  ['17 Pro 1TB Cosmic Orange','9024167576','26462330303','93437609645'],
  ['17 Pro Max 256 Silver','9024167604','26462330372','93437609809'],
  ['17 Pro Max 256 Deep Blue','9024167604','26462330375','93437609814'],
  ['17 Pro Max 256 Cosmic Orange','9024167604','26462330377','93437609812'],
  ['17 Pro Max 512 Silver','9024167604','26462330382','93437609830'],
  ['17 Pro Max 512 Deep Blue','9024167604','26462330386','93437609811'],
  ['17 Pro Max 512 Cosmic Orange','9024167604','26462330388','93437609819'],
  ['17 Pro Max 1TB Silver','9024167604','26462330393','93437609820'],
  ['17 Pro Max 1TB Deep Blue','9024167604','26462330398','93437609856'],
  ['17 Pro Max 1TB Cosmic Orange','9024167604','26462330396','93437609818'],
  ['17 Pro Max 2TB Silver','9024167604','26462330400','93437609844'],
  ['17 Pro Max 2TB Deep Blue','9024167604','26462330402','93437609823'],
  ['17 Pro Max 2TB Cosmic Orange','9024167604','26462330401','93437609851'],
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 1800 },
});

const results = [];
const seenDirect = new Map();

function abs(href) {
  try { return new URL(href, 'https://www.coupang.com').href; } catch { return href; }
}

function directUrlsFromText(text) {
  const out = new Set();
  const decoded = String(text || '')
    .replaceAll('&amp;', '&')
    .replaceAll('\\u0026', '&')
    .replaceAll('\\/', '/');
  for (const m of decoded.matchAll(/(?:https?:\\/\\/www\\.coupang\\.com)?\\/vp\\/products\\/\\d+[^\"'<>\\s]{0,500}?landingType=USED_DETAIL[^\"'<>\\s]{0,500}/gi)) {
    let u = m[0].replace(/[),;]+$/, '');
    out.add(abs(u));
  }
  return [...out];
}

for (const [name, productId, itemId, vendorItemId] of targets) {
  const page = await context.newPage();
  const networkBodies = [];
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/offerList|other-seller|used|return/i.test(u)) {
      try {
        const body = await resp.text();
        networkBodies.push({ url: u, status: resp.status(), body: body.slice(0, 1000000) });
      } catch {}
    }
  });

  const offerListUrl = `https://www.coupang.com/vp/products/${productId}/item/${itemId}/offerList?totalCount=99&vendorItemId=${vendorItemId}`;
  const entry = { name, productId, itemId, vendorItemId, offerListUrl, httpStatus: 0, finalUrl: '', title: '', bodyHasReturn: false, returnText: '', directUrls: [], vendorIds: [], networkDirectUrls: [], error: '' };

  try {
    const resp = await page.goto(offerListUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    entry.httpStatus = resp?.status() || 0;
    try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
    await page.waitForTimeout(800);
    entry.finalUrl = page.url();
    entry.title = await page.title();

    const dom = await page.evaluate(() => {
      const anchors = [...document.querySelectorAll('a')].map(a => ({
        text: String(a.textContent || '').replace(/\\s+/g, ' ').trim(),
        href: a.href || a.getAttribute('href') || ''
      }));
      const text = String(document.body?.innerText || '');
      const html = String(document.documentElement?.innerHTML || '');
      return { anchors, text: text.slice(0, 500000), html: html.slice(0, 2000000) };
    });

    const direct = new Set();
    for (const a of dom.anchors) {
      if (/landingType=USED_DETAIL/i.test(a.href)) direct.add(abs(a.href));
    }
    for (const u of directUrlsFromText(dom.html)) direct.add(u);
    for (const u of directUrlsFromText(dom.text)) direct.add(u);

    entry.bodyHasReturn = /반품\s*-|박스\s*훼손|중고\s*-/i.test(dom.text);
    if (entry.bodyHasReturn) {
      const idx = dom.text.search(/반품\s*-|박스\s*훼손|중고\s*-/i);
      entry.returnText = dom.text.slice(Math.max(0, idx - 300), idx + 1800);
    }
    entry.vendorIds = [...new Set(dom.html.match(/vendorItemId(?:=|%3D|[\"': ]+)\d{8,}/gi)?.map(s => s.match(/\d{8,}/)?.[0]).filter(Boolean) || [])];
    entry.directUrls = [...direct];

    const netDirect = new Set();
    for (const n of networkBodies) for (const u of directUrlsFromText(n.body)) netDirect.add(u);
    entry.networkDirectUrls = [...netDirect];

    for (const u of [...entry.directUrls, ...entry.networkDirectUrls]) seenDirect.set(u, name);
    console.log(JSON.stringify({ name, status: entry.httpStatus, hasReturn: entry.bodyHasReturn, direct: [...direct, ...netDirect] }));
  } catch (error) {
    entry.error = String(error?.stack || error);
    console.error(name, entry.error);
  } finally {
    results.push(entry);
    await page.close();
  }
  await new Promise(r => setTimeout(r, 500));
}

const payload = {
  checkedAt: new Date().toISOString(),
  directUrls: [...seenDirect.entries()].map(([url, source]) => ({ source, url })),
  results,
};
await writeFile('iphone17-return-discovery.json', JSON.stringify(payload, null, 2), 'utf8');
console.log('DISCOVERED_DIRECT_URLS');
for (const x of payload.directUrls) console.log(`${x.source}: ${x.url}`);
await browser.close();
