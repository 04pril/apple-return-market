import { readFile, writeFile } from 'node:fs/promises';

function parseArgs(argv) {
  const out = { input: '', output: 'coupang-2333-parsed.json', vendorItemId: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value == null) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === '--input') out.input = next();
    else if (arg === '--output') out.output = next();
    else if (arg === '--vendor-item-id') out.vendorItemId = next();
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return out;
}

function printHelp() {
  console.log(`\nParse a saved Coupang 2333 JSON response\n\nUsage:\n  node scripts/parse-coupang-2333-response.mjs --input response.json --vendor-item-id 123456789\n\nOptions:\n  --input PATH             Saved 2333 response JSON\n  --vendor-item-id ID      Exact vendorItemId to inspect\n  --output PATH            Sanitized output JSON\n  -h, --help               Show help\n`);
}

const KEYS = new Set([
  'productId', 'itemId', 'vendorItemId', 'isRetailReturnedItem',
  'style', 'layoutStyle', 'offerCondition', 'condition', 'itemCondition',
  'soldOut', 'isOutOfStock', 'isAlmostOOS', 'isAlmostOSS',
  'buyableQuantity', 'remainingQuantity', 'quantity',
  'finalPrice', 'originalPrice', 'discountRate', 'title', 'itemName', 'viewType',
]);

function primitive(value) {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  return undefined;
}

function displayValue(value) {
  const direct = primitive(value);
  if (direct !== undefined) return direct;
  if (Array.isArray(value)) {
    const parts = value.slice(0, 20).map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && typeof entry.text === 'string') return entry.text;
      return '';
    }).filter(Boolean);
    if (parts.length) return parts.join('').slice(0, 500);
  }
  if (value && typeof value === 'object') {
    for (const key of ['text', 'value', 'amount', 'price']) {
      const candidate = primitive(value[key]);
      if (candidate !== undefined) return candidate;
    }
  }
  return undefined;
}

function collectSignals(value, path = '$', out = []) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) collectSignals(value[i], `${path}[${i}]`, out);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (KEYS.has(key)) {
      const shown = displayValue(child);
      if (shown !== undefined) out.push({ path: childPath, key, value: shown });
    }
    if (child && typeof child === 'object') collectSignals(child, childPath, out);
  }
  return out;
}

function findVendorObjects(value, vendorItemId, path = '$', out = []) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) findVendorObjects(value[i], vendorItemId, `${path}[${i}]`, out);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  if (String(value.vendorItemId ?? '') === vendorItemId) out.push({ path, value });
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') findVendorObjects(child, vendorItemId, `${path}.${key}`, out);
  }
  return out;
}

function first(signals, ...keys) {
  for (const key of keys) {
    const hit = signals.find((entry) => entry.key === key);
    if (hit) return hit.value;
  }
  return null;
}

function boolish(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Boolean(value);
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(v)) return true;
    if (['false', '0', 'no', 'n'].includes(v)) return false;
  }
  return null;
}

function deriveState(signals) {
  const soldOut = boolish(first(signals, 'soldOut', 'isOutOfStock'));
  const returned = boolish(first(signals, 'isRetailReturnedItem'));
  const style = String(first(signals, 'style') ?? '').toUpperCase();
  const layoutStyle = String(first(signals, 'layoutStyle') ?? '').toUpperCase();
  if (soldOut === true) return 'sold_out';
  if (soldOut === false && (returned === true || style === 'USED' || layoutStyle === 'USED')) {
    return 'candidate_available';
  }
  return 'unknown';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  if (!args.input) throw new Error('--input is required');
  if (args.vendorItemId && !/^\d+$/.test(args.vendorItemId)) throw new Error('--vendor-item-id must be digits');

  const data = JSON.parse(await readFile(args.input, 'utf8'));
  const globalSignals = collectSignals(data);
  const vendorObjects = args.vendorItemId ? findVendorObjects(data, args.vendorItemId) : [];
  const vendorSignals = vendorObjects.flatMap((entry) => collectSignals(entry.value, entry.path, []));
  const signals = vendorSignals.length ? vendorSignals : globalSignals;

  const result = {
    schemaVersion: 1,
    vendorItemId: args.vendorItemId || first(signals, 'vendorItemId'),
    exactVendorFound: vendorObjects.length > 0,
    rCode: data?.rCode ?? null,
    rMessage: data?.rMessage ?? null,
    returnOffer: {
      isRetailReturnedItem: boolish(first(signals, 'isRetailReturnedItem')),
      style: first(signals, 'style'),
      layoutStyle: first(signals, 'layoutStyle'),
      offerCondition: first(signals, 'offerCondition', 'itemCondition', 'condition'),
    },
    stock: {
      soldOut: boolish(first(signals, 'soldOut', 'isOutOfStock')),
      isAlmostOOS: boolish(first(signals, 'isAlmostOOS', 'isAlmostOSS')),
      buyableQuantity: first(signals, 'buyableQuantity', 'remainingQuantity', 'quantity'),
      state: deriveState(signals),
    },
    pricing: {
      finalPrice: first(signals, 'finalPrice'),
      originalPrice: first(signals, 'originalPrice'),
      discountRate: first(signals, 'discountRate'),
    },
    diagnosticSignals: signals.slice(0, 100),
  };

  await writeFile(args.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
  console.log(`Saved: ${args.output}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
