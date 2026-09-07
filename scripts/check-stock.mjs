import { readFile, writeFile, rename, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const STATUS = Object.freeze({
  AVAILABLE: 'available',
  SOLD_OUT: 'sold_out',
  UNKNOWN: 'unknown',
});

const RETURN_MARKET_RE = /(?:반품\s*-\s*(?:최상|상|중)|박스\s*훼손|중고\s*-\s*(?:최상|상|중))/i;
const SOLD_OUT_RES = [
  /현재\s*판매\s*중인\s*상품이\s*아닙니다/i,
  /현재\s*판매중인\s*상품이\s*아닙니다/i,
  /판매가\s*종료(?:된|되었습니다|되었습니다)?/i,
  /품절되었습니다/i,
  /일시\s*품절/i,
  /재고가\s*없습니다/i,
  /구매할\s*수\s*없는\s*상품/i,
];
const BLOCK_RES = [
  /access denied/i,
  /captcha/i,
  /robot check/i,
  /자동입력\s*방지/i,
  /보안문자/i,
  /비정상적인\s*접근/i,
  /요청이\s*너무\s*많/i,
];
const PURCHASE_TEXT_RE = /^(?:장바구니|바로구매|구매하기|구매)$/;

function parseArgs(argv) {
  const out = {
    all: false,
    limit: 0,
    concurrency: 2,
    delayMs: 1500,
    timeoutMs: 30000,
    headful: false,
    output: 'stock-latest.json',
    resume: false,
    includeUserLinks: true,
    extractOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value == null) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    if (arg === '--all') out.all = true;
    else if (arg === '--headful') out.headful = true;
    else if (arg === '--resume') out.resume = true;
    else if (arg === '--catalog-only') out.includeUserLinks = false;
    else if (arg === '--extract-only') out.extractOnly = true;
    else if (arg === '--limit') out.limit = numberArg(arg, next(), 0, 100000);
    else if (arg === '--concurrency') out.concurrency = numberArg(arg, next(), 1, 8);
    else if (arg === '--delay-ms') out.delayMs = numberArg(arg, next(), 250, 60000);
    else if (arg === '--timeout-ms') out.timeoutMs = numberArg(arg, next(), 5000, 120000);
    else if (arg === '--output') out.output = next();
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return out;
}

function numberArg(name, raw, min, max) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function printHelp() {
  console.log(`\nCoupang return-market stock checker\n\nUsage:\n  npm run stock:check -- --all\n\nOptions:\n  --all                 Scan every extracted target (required unless --limit is used)\n  --limit N             Scan only the first N targets\n  --concurrency N       Browser workers, 1-8 (default: 2)\n  --delay-ms N          Minimum delay per worker, >=250ms (default: 1500)\n  --timeout-ms N        Navigation timeout (default: 30000)\n  --output PATH         Result JSON (default: stock-latest.json)\n  --resume              Reuse completed entries from an existing output file\n  --catalog-only        Ignore extra entries from user-links.js\n  --extract-only        Only parse and count targets; do not launch a browser\n  --headful             Show Chromium for debugging\n  -h, --help            Show this help\n`);
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadJsValue(path, globalName) {
  if (!(await fileExists(path))) return [];
  const source = await readFile(path, 'utf8');
  const sandbox = {
    window: {},
    console: { log() {}, warn() {}, error() {} },
  };
  vm.createContext(sandbox);
  const exportLine = `\n;globalThis.__RETURN_MARKET_EXPORT__ = (typeof ${globalName} !== 'undefined' ? ${globalName} : window.${globalName});`;
  vm.runInContext(source + exportLine, sandbox, {
    filename: path,
    timeout: 10000,
  });
  const value = sandbox.__RETURN_MARKET_EXPORT__;
  return Array.isArray(value) ? value : [];
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function findUrl(record) {
  const direct = firstString(
    record?.url,
    record?.productUrl,
    record?.productURL,
    record?.coupangUrl,
    record?.link,
  );
  if (direct) return direct;
  if (Array.isArray(record?.sourceUrls)) {
    const found = record.sourceUrls.find((v) => typeof v === 'string' && /coupang\.com/i.test(v));
    if (found) return found;
  }
  return '';
}

function idsFromUrl(url) {
  try {
    const parsed = new URL(url);
    const productId = parsed.pathname.match(/\/vp\/products\/(\d+)/)?.[1] || '';
    return {
      productId,
      itemId: parsed.searchParams.get('itemId') || '',
      vendorItemId: parsed.searchParams.get('vendorItemId') || '',
    };
  } catch {
    return { productId: '', itemId: '', vendorItemId: '' };
  }
}

function conditionFromText(value) {
  const match = String(value || '').match(RETURN_MARKET_RE);
  return match?.[0]?.replace(/\s+/g, ' ').trim() || '';
}

function normalizeRecord(record, source, index) {
  if (Array.isArray(record)) {
    if (typeof record[0] === 'string' && typeof record[1] === 'string') {
      const ids = idsFromUrl(record[1]);
      return {
        source,
        sourceIndex: index,
        name: record[0],
        url: record[1],
        ...ids,
        condition: conditionFromText(record[0]),
        snapshotStatus: '',
      };
    }
    return null;
  }

  if (!record || typeof record !== 'object') return null;

  const url = findUrl(record);
  const fromUrl = idsFromUrl(url);
  const productId = firstString(record.productId, record.product_id, fromUrl.productId);
  const itemId = firstString(record.itemId, record.item_id, fromUrl.itemId);
  const vendorItemId = firstString(record.vendorItemId, record.vendor_item_id, fromUrl.vendorItemId);
  const finalUrl = url || (productId ? `https://www.coupang.com/vp/products/${productId}` : '');
  if (!finalUrl || !/coupang\.com/i.test(finalUrl)) return null;

  return {
    source,
    sourceIndex: index,
    name: firstString(record.name, record.title, record.productName, `product-${productId || index}`),
    url: finalUrl,
    productId,
    itemId,
    vendorItemId,
    condition: firstString(record.condition, record.grade, conditionFromText(record.name), conditionFromText(record.note)),
    snapshotStatus: firstString(record.status, typeof record.available === 'boolean' ? (record.available ? 'available' : 'sold_out') : ''),
  };
}

function collectTargets(catalog, userLinks) {
  const normalized = [];
  for (let i = 0; i < catalog.length; i += 1) {
    const item = normalizeRecord(catalog[i], 'catalog-data.js', i);
    if (item) normalized.push(item);
  }
  for (let i = 0; i < userLinks.length; i += 1) {
    const item = normalizeRecord(userLinks[i], 'user-links.js', i);
    if (item) normalized.push(item);
  }

  const map = new Map();
  for (const target of normalized) {
    const key = target.vendorItemId
      ? `vendor:${target.vendorItemId}`
      : target.itemId
        ? `item:${target.productId || 'unknown'}:${target.itemId}`
        : target.productId
          ? `product:${target.productId}`
          : `url:${target.url}`;

    const current = map.get(key);
    if (!current || (target.source === 'user-links.js' && current.source !== 'user-links.js')) {
      map.set(key, { ...target, key });
    }
  }
  return [...map.values()];
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function containsAny(text, patterns) {
  return patterns.find((re) => re.test(text)) || null;
}

async function inspectPage(page, target, timeoutMs) {
  let response;
  try {
    response = await page.goto(target.url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
  } catch (error) {
    return result(STATUS.UNKNOWN, 'navigation_error', target, {
      error: String(error?.message || error).slice(0, 500),
      finalUrl: page.url(),
    });
  }

  const httpStatus = response?.status() || 0;
  if (httpStatus === 403 || httpStatus === 429) {
    return result(STATUS.UNKNOWN, `http_${httpStatus}`, target, {
      httpStatus,
      finalUrl: page.url(),
    });
  }
  if (httpStatus >= 500) {
    return result(STATUS.UNKNOWN, `http_${httpStatus}`, target, {
      httpStatus,
      finalUrl: page.url(),
    });
  }

  try {
    await page.waitForLoadState('networkidle', { timeout: Math.min(5000, timeoutMs) });
  } catch {
    // Many Coupang pages keep background connections open. DOM evidence is enough.
  }

  let pageData;
  try {
    pageData = await page.evaluate((purchasePatternSource) => {
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const purchasePattern = new RegExp(purchasePatternSource);
      const controls = [...document.querySelectorAll('button, a')]
        .filter(visible)
        .map((el) => ({
          text: String(el.textContent || '').replace(/\s+/g, ' ').trim(),
          disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
        }))
        .filter((entry) => purchasePattern.test(entry.text));

      const bodyText = String(document.body?.innerText || '').slice(0, 500000);
      return {
        title: document.title,
        bodyText,
        controls,
      };
    }, PURCHASE_TEXT_RE.source);
  } catch (error) {
    return result(STATUS.UNKNOWN, 'dom_inspection_error', target, {
      httpStatus,
      finalUrl: page.url(),
      error: String(error?.message || error).slice(0, 500),
    });
  }

  const combined = `${pageData.title}\n${pageData.bodyText}`;
  const blocked = containsAny(combined, BLOCK_RES);
  if (blocked) {
    return result(STATUS.UNKNOWN, 'blocked_or_challenge', target, {
      httpStatus,
      finalUrl: page.url(),
      evidence: blocked.source,
    });
  }

  const enabledPurchase = pageData.controls.some((control) => !control.disabled);
  const soldMatch = containsAny(combined, SOLD_OUT_RES);
  const returnMarketVisible = RETURN_MARKET_RE.test(combined);
  const finalIds = idsFromUrl(page.url());
  const vendorSelected = Boolean(
    target.vendorItemId && finalIds.vendorItemId === target.vendorItemId,
  );

  if (target.vendorItemId) {
    if (enabledPurchase && vendorSelected && returnMarketVisible) {
      return result(STATUS.AVAILABLE, 'vendor_return_offer_buyable', target, {
        httpStatus,
        finalUrl: page.url(),
        returnMarketVisible,
        vendorSelected,
        purchaseControls: pageData.controls,
      });
    }
    if (soldMatch && !enabledPurchase) {
      return result(STATUS.SOLD_OUT, 'explicit_sold_out', target, {
        httpStatus,
        finalUrl: page.url(),
        evidence: soldMatch.source,
        returnMarketVisible,
        vendorSelected,
      });
    }
    const reason = !vendorSelected
      ? 'vendor_offer_not_selected'
      : !returnMarketVisible
        ? 'return_offer_not_visible'
        : 'vendor_offer_state_unclear';
    return result(STATUS.UNKNOWN, reason, target, {
      httpStatus,
      finalUrl: page.url(),
      returnMarketVisible,
      vendorSelected,
      purchaseControls: pageData.controls,
    });
  }

  if (enabledPurchase && returnMarketVisible) {
    return result(STATUS.AVAILABLE, 'return_market_offer_visible', target, {
      httpStatus,
      finalUrl: page.url(),
      returnMarketVisible,
      purchaseControls: pageData.controls,
    });
  }
  if (soldMatch && !enabledPurchase) {
    return result(STATUS.SOLD_OUT, 'explicit_sold_out', target, {
      httpStatus,
      finalUrl: page.url(),
      evidence: soldMatch.source,
      returnMarketVisible,
    });
  }
  return result(STATUS.UNKNOWN, returnMarketVisible ? 'return_offer_state_unclear' : 'no_return_offer_evidence', target, {
    httpStatus,
    finalUrl: page.url(),
    returnMarketVisible,
    purchaseControls: pageData.controls,
  });
}

function result(status, reason, target, extra = {}) {
  return {
    key: target.key,
    name: target.name,
    source: target.source,
    sourceIndex: target.sourceIndex,
    url: target.url,
    productId: target.productId,
    itemId: target.itemId,
    vendorItemId: target.vendorItemId,
    condition: target.condition,
    snapshotStatus: target.snapshotStatus,
    status,
    reason,
    checkedAt: new Date().toISOString(),
    ...extra,
  };
}

function summarize(items) {
  const summary = { available: 0, sold_out: 0, unknown: 0 };
  for (const item of Object.values(items)) {
    if (item.status in summary) summary[item.status] += 1;
  }
  return summary;
}

async function writeOutput(path, state) {
  const abs = resolve(path);
  const tmp = `${abs}.tmp`;
  const items = Object.fromEntries([...state.items.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const payload = {
    schemaVersion: 1,
    source: '04pril/apple-return-market',
    startedAt: state.startedAt,
    updatedAt: new Date().toISOString(),
    finishedAt: state.finishedAt || null,
    totalTargets: state.totalTargets,
    completedTargets: state.items.size,
    summary: summarize(items),
    items,
  };
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await rename(tmp, abs);
}

async function readExisting(path) {
  if (!(await fileExists(path))) return new Map();
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return new Map(Object.entries(parsed.items || {}));
  } catch {
    return new Map();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.all && args.limit === 0) {
    throw new Error('Refusing an accidental full scan. Pass --all or --limit N.');
  }

  const root = process.cwd();
  const catalogPath = resolve(root, 'catalog-data.js');
  const userLinksPath = resolve(root, 'user-links.js');
  const catalog = await loadJsValue(catalogPath, 'RETURN_MARKET_DEFAULT_PRODUCTS');
  const userLinks = args.includeUserLinks
    ? await loadJsValue(userLinksPath, 'RETURN_MARKET_USER_LINKS')
    : [];

  let targets = collectTargets(catalog, userLinks);
  if (args.limit > 0) targets = targets.slice(0, args.limit);
  if (targets.length === 0) {
    throw new Error('No Coupang targets were extracted from catalog-data.js/user-links.js.');
  }

  const existingRaw = args.resume ? await readExisting(args.output) : new Map();
  const targetKeys = new Set(targets.map((target) => target.key));
  const existing = new Map([...existingRaw].filter(([key]) => targetKeys.has(key)));
  const state = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    totalTargets: targets.length,
    items: existing,
  };

  const pending = targets.filter((target) => !existing.has(target.key));
  const vendorTargets = targets.filter((target) => target.vendorItemId).length;
  const itemTargets = targets.filter((target) => !target.vendorItemId && target.itemId).length;
  const productTargets = targets.filter((target) => !target.vendorItemId && !target.itemId && target.productId).length;
  const urlTargets = targets.length - vendorTargets - itemTargets - productTargets;
  console.log(`Extracted ${targets.length} unique targets (${catalog.length} catalog rows, ${userLinks.length} user-link rows).`);
  console.log(`Targets: vendor=${vendorTargets}, item=${itemTargets}, product=${productTargets}, url=${urlTargets}`);
  if (existing.size) console.log(`Resuming with ${existing.size} completed entries; ${pending.length} remain.`);
  if (args.extractOnly) return;

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: !args.headful });
  const context = await browser.newContext({
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });

  let cursor = 0;
  let completedThisRun = 0;
  let stopping = false;

  const persist = async () => {
    try {
      await writeOutput(args.output, state);
    } catch (error) {
      console.error('Failed to persist scan output:', error);
    }
  };

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('\nStopping after the current item and saving partial results...');
    await persist();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  async function worker(workerId) {
    const page = await context.newPage();
    try {
      while (!stopping) {
        const index = cursor++;
        if (index >= pending.length) break;
        const target = pending[index];
        const scan = await inspectPage(page, target, args.timeoutMs);
        state.items.set(target.key, scan);
        completedThisRun += 1;
        console.log(
          `[${state.items.size}/${targets.length}] worker=${workerId} ${scan.status.padEnd(8)} ${target.name.slice(0, 70)} (${scan.reason})`,
        );
        if (completedThisRun % 10 === 0) await persist();
        if (!stopping && args.delayMs > 0) await sleep(args.delayMs);
      }
    } finally {
      await page.close();
    }
  }

  await Promise.all(Array.from({ length: Math.min(args.concurrency, pending.length || 1) }, (_, i) => worker(i + 1)));
  state.finishedAt = stopping ? null : new Date().toISOString();
  await persist();
  await browser.close();

  const finalSummary = summarize(Object.fromEntries(state.items));
  console.log('\nScan complete.');
  console.log(JSON.stringify(finalSummary, null, 2));
  console.log(`Saved: ${resolve(args.output)}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
