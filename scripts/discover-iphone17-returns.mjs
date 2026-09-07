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

function absolute(href) {
  try { return new URL(href, 'https://www.coupang.com').href; } catch { return href || ''; }
}

function idsFromUrl(url) {
  try {
    const u = new URL(url);
    return {
      productId: u.pathname.match(/\/vp\/products\/(\d+)/)?.[1] || '',
      itemId: u.searchParams.get('itemId') || u.pathname.match(/\/item\/(\d+)/)?.[1] || '',
      vendorItemId: u.searchParams.get('vendorItemId') || '',
      landingType: u.searchParams.get('landingType') || '',
    };
  } catch { return { productId:'', itemId:'', vendorItemId:'', landingType:'' }; }
}

async function inspect(page) {
  return await page.evaluate(() => {
    const els = [...document.querySelectorAll('a,button')];
    const links = els.map(el => ({
      tag: el.tagName,
      text: String(el.textContent || '').replace(/\s+/g,' ').trim(),
      href: el.tagName === 'A' ? (el.href || el.getAttribute('href') || '') : '',
    })).filter(x => x.href || /반품|박스\s*훼손|중고|상세보기|다른 판매자/i.test(x.text));
    const text = String(document.body?.innerText || '').slice(0, 600000);
    const html = String(document.documentElement?.innerHTML || '').slice(0, 3000000);
    return { title: document.title, text, html, links };
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 1800 },
});

const output = { checkedAt: new Date().toISOString(), directUrls: [], entries: [] };
const directSet = new Set();

for (const [name, productId, itemId, normalVendor] of targets) {
  const page = await context.newPage();
  const networkUrls = new Set();
  page.on('request', req => {
    const u = req.url();
    if (/offerList|other-seller|used|return/i.test(u)) networkUrls.add(u);
  });
  page.on('response', resp => {
    const u = resp.url();
    if (/offerList|other-seller|used|return/i.test(u)) networkUrls.add(u);
  });

  const baseUrl = `https://www.coupang.com/vp/products/${productId}?itemId=${itemId}&vendorItemId=${normalVendor}`;
  const record = { name, productId, itemId, normalVendor, baseUrl, base: null, offerPages: [], found: [], error: '' };

  try {
    let resp = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    try { await page.waitForLoadState('networkidle', { timeout: 4000 }); } catch {}
    await page.waitForTimeout(700);
    const dom = await inspect(page);
    record.base = { status: resp?.status() || 0, finalUrl: page.url(), title: dom.title, hasReturnText: /반품\s*-|박스\s*훼손|중고\s*-/i.test(dom.text), relevantLinks: dom.links.filter(x => /offerList|USED_DETAIL|반품|박스\s*훼손|중고|다른 판매자|상세보기/i.test(`${x.href} ${x.text}`)).slice(0,100), networkUrls: [...networkUrls] };

    const candidateOffers = new Set();
    for (const l of dom.links) if (/offerList/i.test(l.href)) candidateOffers.add(absolute(l.href));
    for (const u of networkUrls) if (/offerList/i.test(u)) candidateOffers.add(absolute(u));
    for (const total of [2,3,4,5,10,99]) candidateOffers.add(`https://www.coupang.com/vp/products/${productId}/item/${itemId}/offerList?totalCount=${total}&vendorItemId=${normalVendor}`);

    const directCandidates = new Set();
    for (const l of dom.links) if (/USED_DETAIL/i.test(l.href)) directCandidates.add(absolute(l.href));

    for (const offerUrl of [...candidateOffers]) {
      networkUrls.clear();
      try {
        resp = await page.goto(offerUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        try { await page.waitForLoadState('networkidle', { timeout: 2500 }); } catch {}
        await page.waitForTimeout(350);
        const odom = await inspect(page);
        const rel = odom.links.filter(x => /USED_DETAIL|반품|박스\s*훼손|중고/i.test(`${x.href} ${x.text}`));
        for (const l of rel) if (/USED_DETAIL/i.test(l.href)) directCandidates.add(absolute(l.href));
        for (const u of networkUrls) if (/USED_DETAIL/i.test(u)) directCandidates.add(absolute(u));
        record.offerPages.push({ url: offerUrl, status: resp?.status() || 0, finalUrl: page.url(), title: odom.title, hasReturnText: /반품\s*-|박스\s*훼손|중고\s*-/i.test(odom.text), returnSnippet: (() => { const i = odom.text.search(/반품\s*-|박스\s*훼손|중고\s*-/i); return i >= 0 ? odom.text.slice(Math.max(0,i-250), i+1600) : ''; })(), relevantLinks: rel.slice(0,100) });
      } catch (e) {
        record.offerPages.push({ url: offerUrl, error: String(e?.message || e) });
      }
    }

    for (const u of directCandidates) {
      const ids = idsFromUrl(u);
      if (ids.landingType === 'USED_DETAIL' || /landingType=USED_DETAIL/i.test(u)) {
        record.found.push({ url: u, ...ids });
        directSet.add(u);
      }
    }
    console.log(JSON.stringify({ name, found: record.found.map(x => x.url), baseHasReturn: record.base?.hasReturnText }));
  } catch (e) {
    record.error = String(e?.stack || e);
    console.error(name, record.error);
  } finally {
    output.entries.push(record);
    await page.close();
  }
  await new Promise(r => setTimeout(r, 300));
}

output.directUrls = [...directSet];
await writeFile('iphone17-return-discovery.json', JSON.stringify(output, null, 2), 'utf8');
console.log('DIRECT_URLS_START');
for (const u of output.directUrls) console.log(u);
console.log('DIRECT_URLS_END');
await browser.close();
