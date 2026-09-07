import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';

function intArg(name, raw, min, max) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function parseArgs(argv) {
  const out = {
    queue: 'coupang-app-queue-iphone.json',
    start: 0,
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

    if (arg === '--queue') out.queue = next();
    else if (arg === '--start') out.start = intArg(arg, next(), 0, 1000000);
    else if (arg === '--limit') out.limit = intArg(arg, next(), 1, 1000000);
    else if (arg === '--all') out.all = true;
    else if (arg === '--output') out.output = next();
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return out;
}

function printHelp() {
  console.log(`\nExport a Coupang app queue as one HTTPS URL per line for iPhone Shortcuts.\n\nUsage:\n  npm run stock:shortcuts -- --queue coupang-app-queue-iphone.json --limit 20\n  npm run stock:shortcuts -- --queue coupang-app-queue-iphone.json --start 20 --limit 20\n  npm run stock:shortcuts -- --queue coupang-app-queue-iphone.json --all\n\nOptions:\n  --queue PATH   queue JSON (default: coupang-app-queue-iphone.json)\n  --start N      skip the first N queue items (default: 0)\n  --limit N      export at most N items (default: 20)\n  --all          export every remaining item after --start\n  --output PATH  output .txt path\n  -h, --help     show this help\n`);
}

function defaultOutput(queuePath) {
  const file = basename(queuePath, extname(queuePath));
  return resolve(dirname(queuePath), `${file.replace(/^coupang-app-queue-/, 'coupang-shortcuts-')}.txt`);
}

function validCoupangUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:'
      && url.hostname === 'www.coupang.com'
      && /^\/vp\/products\/\d+$/.test(url.pathname)
      && /^\d+$/.test(url.searchParams.get('itemId') || '')
      && /^\d+$/.test(url.searchParams.get('vendorItemId') || '')
      && url.searchParams.get('landingType') === 'USED_DETAIL';
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  const queuePath = resolve(args.queue);
  const payload = JSON.parse(await readFile(queuePath, 'utf8'));
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) throw new Error(`Queue contains no items: ${queuePath}`);
  if (args.start >= items.length) throw new Error(`--start ${args.start} is outside queue length ${items.length}`);

  const remaining = items.slice(args.start);
  const selected = args.all ? remaining : remaining.slice(0, args.limit);
  const invalid = selected.find((item) => !validCoupangUrl(item?.url));
  if (invalid) {
    throw new Error(`Queue contains an unexpected/non-exact Coupang URL near vendorItemId=${invalid?.vendorItemId || 'unknown'}`);
  }

  const outputPath = resolve(args.output || defaultOutput(queuePath));
  const text = `${selected.map((item) => item.url).join('\n')}\n`;
  await writeFile(outputPath, text, 'utf8');

  console.log(`Queue: ${queuePath}`);
  console.log(`URLs exported: ${selected.length} / ${items.length}, start=${args.start}`);
  console.log(`Saved: ${outputPath}`);
  console.log('iPhone Shortcuts recipe: Get File -> Get Text from Input -> Split Text by New Lines -> Repeat with Each -> Open URLs (Repeat Item) -> Wait 5 seconds.');
  console.log('Keep mitmweb capture running while the shortcut opens the links.');
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
