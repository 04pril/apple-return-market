import { writeFile } from 'node:fs/promises';

const DEFAULT_OUTPUT = 'coupang-api-probe.json';
const DEFAULT_TIMEOUT_MS = 15000;

function parseArgs(argv) {
  const out = {
    productId: '',
    itemId: '',
    vendorItemId: '',
    output: DEFAULT_OUTPUT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value == null) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    if (arg === '--product-id') out.productId = next();
    else if (arg === '--item-id') out.itemId = next();
    else if (arg === '--vendor-item-id') out.vendorItemId = next();
    else if (arg === '--output') out.output = next();
    else if (arg === '--timeout-ms') out.timeoutMs = Number(next());
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return out;
}

function printHelp() {
  console.log(`\nCoupang mobile/API endpoint probe\n\nUsage:\n  node scripts/probe-coupang-api.mjs --product-id ID --item-id ID --vendor-item-id ID\n\nOptions:\n  --product-id ID       Coupang productId\n  --item-id ID          Coupang itemId\n  --vendor-item-id ID   Exact vendorItemId\n  --output PATH         JSON result path (default: ${DEFAULT_OUTPUT})\n  --timeout-ms N        Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})\n  -h, --help            Show this help\n`);
}

function requireNumeric(name, value) {
  if (!/^\d+$/.test(String(value || ''))) {
    throw new Error(`${name} must contain digits only.`);
  }
  return String(value);
}

const APP_HEADERS = Object.freeze({
  accept: 'application/json,text/plain,*/*',
  'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.5,en;q=0.3',
  'user-agent': 'Coupang_New/8.3.4 (iPhone; iOS 18.0; Scale/3.00)',
  'coupang-app': 'COUPANG|IOS|18.0|8.3.4',
});

const MOBILE_WEB_HEADERS = Object.freeze({
  accept: 'application/json,text/plain,*/*',
  'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.5,en;q=0.3',
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});

const INTERESTING_KEYS = new Set([
  'rCode',
  'rMessage',
  'productId',
  'itemId',
  'vendorItemId',
  'soldOut',
  'isOutOfStock',
  'isAlmostOSS',
  'buyableQuantity',
  'quantity',
  'remainingQuantity',
  'salesPrice',
  'couponPrice',
  'finalPrice',
  'originalPrice',
  'landingType',
  'condition',
  'itemCondition',
  'itemStatus',
  'status',
  'viewType',
]);

function isPrimitive(value) {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value);
}

function valuePreview(value) {
  if (typeof value === 'string') return value.slice(0, 300);
  return value;
}

function collectSignals(value, path = '$', out = [], depth = 0) {
  if (depth > 18 || out.length >= 300) return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length && out.length < 300; i += 1) {
      collectSignals(value[i], `${path}[${i}]`, out, depth + 1);
    }
    return out;
  }
  if (!value || typeof value !== 'object') return out;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (INTERESTING_KEYS.has(key) && isPrimitive(child)) {
      out.push({ path: childPath, key, value: valuePreview(child) });
    }
    if (child && typeof child === 'object') {
      collectSignals(child, childPath, out, depth + 1);
    }
    if (out.length >= 300) break;
  }
  return out;
}

function collectTargetObjects(value, targetVendorItemId, path = '$', out = [], depth = 0) {
  if (depth > 18 || out.length >= 50) return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length && out.length < 50; i += 1) {
      collectTargetObjects(value[i], targetVendorItemId, `${path}[${i}]`, out, depth + 1);
    }
    return out;
  }
  if (!value || typeof value !== 'object') return out;

  const vendorValue = value.vendorItemId;
  if (vendorValue != null && String(vendorValue) === targetVendorItemId) {
    out.push({
      path,
      signals: collectSignals(value, path, [], 0).slice(0, 80),
    });
  }

  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') {
      collectTargetObjects(child, targetVendorItemId, `${path}.${key}`, out, depth + 1);
    }
    if (out.length >= 50) break;
  }
  return out;
}

function findFirstSignal(signals, key) {
  return signals.find((entry) => entry.key === key)?.value;
}

function deriveVerdict(signals, targetObjects) {
  const targetSignals = targetObjects.flatMap((entry) => entry.signals || []);
  const source = targetSignals.length ? targetSignals : signals;
  const exactVendorFound = targetObjects.length > 0;

  const soldOutValues = source
    .filter((entry) => entry.key === 'soldOut' || entry.key === 'isOutOfStock')
    .map((entry) => entry.value)
    .filter((value) => typeof value === 'boolean');
  const quantities = source
    .filter((entry) => entry.key === 'buyableQuantity' || entry.key === 'remainingQuantity')
    .map((entry) => Number(entry.value))
    .filter(Number.isFinite);

  if (exactVendorFound && soldOutValues.includes(true)) {
    return { status: 'sold_out', reason: 'exact_vendor_stock_flag_true' };
  }
  if (exactVendorFound && quantities.some((value) => value > 0) && soldOutValues.includes(false)) {
    return { status: 'available', reason: 'exact_vendor_buyable_quantity_and_stock_flag' };
  }
  if (exactVendorFound && soldOutValues.length > 0 && soldOutValues.every((value) => value === false)) {
    return { status: 'available', reason: 'exact_vendor_stock_flag_false' };
  }
  if (exactVendorFound) {
    return { status: 'unknown', reason: 'exact_vendor_found_without_decisive_stock_signal' };
  }
  return { status: 'unknown', reason: 'exact_vendor_not_found_in_response' };
}

async function requestEndpoint(endpoint, target, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const response = await fetch(endpoint.url, {
      method: endpoint.method,
      headers: endpoint.headers,
      body: endpoint.body,
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';
    let json = null;
    let parseError = '';
    try {
      json = JSON.parse(text);
    } catch (error) {
      parseError = String(error?.message || error).slice(0, 300);
    }

    const signals = json ? collectSignals(json) : [];
    const targetObjects = json ? collectTargetObjects(json, target.vendorItemId) : [];
    const rCode = json && typeof json === 'object' ? json.rCode ?? null : null;
    const rMessage = json && typeof json === 'object' ? json.rMessage ?? null : null;
    const verdict = json
      ? deriveVerdict(signals, targetObjects)
      : { status: 'unknown', reason: 'response_not_json' };

    return {
      name: endpoint.name,
      method: endpoint.method,
      requestUrl: endpoint.url,
      httpStatus: response.status,
      ok: response.ok,
      finalUrl: response.url,
      contentType,
      elapsedMs: Date.now() - started,
      rCode,
      rMessage: typeof rMessage === 'string' ? rMessage.slice(0, 300) : rMessage,
      exactVendorFound: targetObjects.length > 0,
      targetObjectCount: targetObjects.length,
      verdict,
      topLevelKeys: json && typeof json === 'object' && !Array.isArray(json)
        ? Object.keys(json).slice(0, 50)
        : [],
      signals: signals.slice(0, 160),
      targetObjects: targetObjects.slice(0, 12),
      responseBytes: Buffer.byteLength(text),
      parseError,
      nonJsonPreview: json ? '' : text.replace(/\s+/g, ' ').slice(0, 500),
    };
  } catch (error) {
    return {
      name: endpoint.name,
      method: endpoint.method,
      requestUrl: endpoint.url,
      httpStatus: 0,
      ok: false,
      elapsedMs: Date.now() - started,
      error: error?.name === 'AbortError'
        ? `timeout_after_${timeoutMs}ms`
        : String(error?.message || error).slice(0, 500),
      exactVendorFound: false,
      verdict: { status: 'unknown', reason: 'request_error' },
      signals: [],
      targetObjects: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildEndpoints(target) {
  const product = encodeURIComponent(target.productId);
  const item = encodeURIComponent(target.itemId);
  const vendor = encodeURIComponent(target.vendorItemId);

  const query2333 = new URLSearchParams({
    deliveryFeeToggleStatusFromPrevPage: 'false',
    pvId: '',
    egiftPromotion: 'false',
    clickEventId: '',
    trAid: '',
    rank: '0',
    sourceType: 'SDP_TOP_BANNER',
    unitPriceWithDeliveryFee: 'false',
    sid: '',
    implicitLogging: '',
    productId: target.productId,
    itemId: target.itemId,
    vendorItemId: target.vendorItemId,
  });

  return [
    {
      name: 'cmapi-2333-product',
      method: 'POST',
      url: `https://cmapi.coupang.com/modular/v1/endpoints/2333/sdp/v2/platform/products/${product}?${query2333}`,
      headers: {
        ...APP_HEADERS,
        'content-type': 'application/json',
      },
      body: '{}',
    },
    {
      name: 'cmapi-2334-exact-vendor',
      method: 'GET',
      url: `https://cmapi.coupang.com/modular/v1/endpoints/2334/sdp/v2/platform/products/${product}/items/${item}/vendor-items/${vendor}`,
      headers: APP_HEADERS,
    },
    {
      name: 'mobile-vm-v4-vendor',
      method: 'GET',
      url: `https://m.coupang.com/vm/v4/products/${product}/vendor-items/${vendor}`,
      headers: MOBILE_WEB_HEADERS,
    },
    {
      name: 'mobile-vm-v4-product',
      method: 'GET',
      url: `https://m.coupang.com/vm/v4/enhanced-pdp/products/${product}`,
      headers: MOBILE_WEB_HEADERS,
    },
  ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const target = {
    productId: requireNumeric('productId', args.productId),
    itemId: requireNumeric('itemId', args.itemId),
    vendorItemId: requireNumeric('vendorItemId', args.vendorItemId),
  };
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000 || args.timeoutMs > 120000) {
    throw new Error('timeoutMs must be between 1000 and 120000.');
  }

  console.log(`Probing Coupang APIs for product=${target.productId} item=${target.itemId} vendor=${target.vendorItemId}`);
  const endpoints = buildEndpoints(target);
  const results = [];

  // Run sequentially so a single diagnostic does not look like a burst of automated traffic.
  for (const endpoint of endpoints) {
    console.log(`\n== ${endpoint.name} ==`);
    const result = await requestEndpoint(endpoint, target, args.timeoutMs);
    results.push(result);
    console.log(`HTTP: ${result.httpStatus || 'ERR'}  JSON: ${result.parseError ? 'no' : 'yes'}  elapsed=${result.elapsedMs}ms`);
    if (result.rCode != null) console.log(`rCode: ${result.rCode}  rMessage: ${result.rMessage ?? ''}`);
    console.log(`exactVendorFound: ${Boolean(result.exactVendorFound)}`);
    console.log(`verdict: ${result.verdict?.status || 'unknown'} (${result.verdict?.reason || 'no_reason'})`);
    const stockSignals = (result.signals || []).filter((entry) =>
      ['vendorItemId', 'soldOut', 'isOutOfStock', 'isAlmostOSS', 'buyableQuantity', 'remainingQuantity', 'salesPrice', 'couponPrice', 'finalPrice'].includes(entry.key),
    );
    for (const signal of stockSignals.slice(0, 30)) {
      console.log(`  ${signal.path} = ${JSON.stringify(signal.value)}`);
    }
  }

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    target,
    note: 'Diagnostic only. A successful endpoint response is not treated as stock proof unless the exact vendorItemId and stock signals are present.',
    results,
  };
  await writeFile(args.output, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`\nSaved diagnostic: ${args.output}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
