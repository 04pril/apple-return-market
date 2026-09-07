import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const GROUPS = new Set(['all', 'macbook', 'ipad', 'iphone', 'other']);

function parseArgs(argv) {
  const out = {
    group: 'all',
    offset: 0,
    limit: 20,
    all: false,
    output: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value == null) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    if (arg === '--group') out.group = next().toLowerCase();
    else if (arg === '--offset') out.offset = intArg(arg, next(), 0, 1000000);
    else if (arg === '--limit') out.limit = intArg(arg, next(), 1, 1000000);
    else if (arg === '--all') out.all = true;
    else if (arg === '--output') out.output = next();
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!GROUPS.has(out.group)) {
    throw new Error(`--group must be one of: ${[...GROUPS].join(', ')}`);
  }
  return out;
}

function intArg(name, raw, min, max) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function printHelp() {
  console.log(`\nBuild a safe queue of Coupang return-offer URLs for opening in the real app.\n\nUsage:\n  npm run stock:app-queue -- --group iphone --limit 20\n  npm run stock:app-queue -- --group macbook --offset 20 --limit 20\n  npm run stock:app-queue -- --group all --all\n\nOptions:\n  --group NAME   all | macbook | ipad | iphone | other (default: all)\n  --offset N     skip the first N complete targets (default: 0)\n  --limit N      emit at most N targets (default: 20)\n  --all          emit every complete target after --offset\n  --output PATH  output JSON path\n  -h, --help     show this help\n`);
}

async function loadCatalog(path) {
  const source = await readFile(path, 'utf8');
  const sandbox = { window: {}, console: { log() {}, warn() {}, error() {} } };
  vm.createContext(sandbox);
  vm.runInContext(
    source + '\n;globalThis.__CATALOG__ = window.RETURN_MARKET_DEFAULT_PRODUCTS;',
    sandbox,
    { filename: path, timeout: 10000 },
  );
  return Array.isArray(sandbox.__CATALOG__) ? sandbox.__CATALOG__ : [];
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

function groupFor(category, name) {
  const normalized = String(category || '').trim().toLowerCase();
  if (normalized === 'ipad') return 'ipad';
  if (normalized === 'iphone') return 'iphone';
  if (normalized === 'mac') return /\bmacbook\b|맥북/i.test(name) ? 'macbook' : 'other';
  return 'other';
}

function canonicalUrl(productId, itemId, vendorItemId) {
  const query = new URLSearchParams({ itemId, vendorItemId, landingType: 'USED_DETAIL' });
  return `https://www.coupang.com/vp/products/${productId}?${query}`;
}

function normalizeRow(row, index) {
  if (!Array.isArray(row)) return null;
  const category = String(row[0] ?? '').trim();
  const name = String(row[1] ?? '').trim();
  const originalUrl = String(row[2] ?? '').trim();
  const ids = idsFromUrl(originalUrl);
  if (!/^\d+$/.test(ids.productId) || !/^\d+$/.test(ids.itemId) || !/^\d+$/.test(ids.vendorItemId)) {
    return null;
  }

  return {
    key: `vendor:${ids.vendorItemId}`,
    sourceIndex: index,
    group: groupFor(category, name),
    category,
    name,
    condition: String(row[3] ?? '').trim(),
    snapshotOriginalPrice: Number.isFinite(Number(row[4])) ? Number(row[4]) : null,
    snapshotReturnPrice: Number.isFinite(Number(row[5])) ? Number(row[5]) : null,
    snapshotDiscountRate: Number.isFinite(Number(row[6])) ? Number(row[6]) : null,
    snapshotStatus: String(row[7] ?? '').trim(),
    productId: ids.productId,
    itemId: ids.itemId,
    vendorItemId: ids.vendorItemId,
    originalUrl,
    url: canonicalUrl(ids.productId, ids.itemId, ids.vendorItemId),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const catalog = await loadCatalog(resolve(repoRoot, 'catalog-data.js'));
  const normalized = catalog.map(normalizeRow).filter(Boolean);

  const deduped = [];
  const seen = new Set();
  for (const item of normalized) {
    if (seen.has(item.vendorItemId)) continue;
    seen.add(item.vendorItemId);
    deduped.push(item);
  }

  const grouped = args.group === 'all' ? deduped : deduped.filter((item) => item.group === args.group);
  const afterOffset = grouped.slice(args.offset);
  const items = args.all ? afterOffset : afterOffset.slice(0, args.limit);
  const output = resolve(repoRoot, args.output || `coupang-app-queue-${args.group}.json`);

  const payload = {
    schemaVersion: 1,
    source: 'catalog-data.js',
    generatedAt: new Date().toISOString(),
    group: args.group,
    catalogRows: catalog.length,
    completeTargets: deduped.length,
    groupTargets: grouped.length,
    offset: args.offset,
    requestedAll: args.all,
    targetCount: items.length,
    items,
  };

  await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Catalog rows: ${catalog.length}`);
  console.log(`Complete exact-vendor targets: ${deduped.length}`);
  console.log(`Group ${args.group}: ${grouped.length}`);
  console.log(`Queue: ${items.length} target(s), offset ${args.offset}`);
  console.log(`Saved: ${output}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
