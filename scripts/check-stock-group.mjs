import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const GROUPS = new Set(['all', 'macbook', 'ipad', 'iphone', 'other']);

function parseGroupArgs(argv) {
  let group = 'all';
  const passthrough = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--group') {
      const value = argv[++i];
      if (!value) throw new Error('Missing value for --group');
      group = value.toLowerCase();
      if (!GROUPS.has(group)) {
        throw new Error(`--group must be one of: ${[...GROUPS].join(', ')}`);
      }
      continue;
    }
    passthrough.push(arg);
  }

  return { group, passthrough };
}

async function loadJsArray(path, globalName) {
  const source = await readFile(path, 'utf8');
  const sandbox = {
    window: {},
    console: { log() {}, warn() {}, error() {} },
  };
  vm.createContext(sandbox);
  const exportLine = `\n;globalThis.__RETURN_MARKET_EXPORT__ = (typeof ${globalName} !== 'undefined' ? ${globalName} : window.${globalName});`;
  vm.runInContext(source + exportLine, sandbox, { filename: path, timeout: 10000 });
  const value = sandbox.__RETURN_MARKET_EXPORT__;
  return Array.isArray(value) ? value : [];
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function recordName(record) {
  if (Array.isArray(record)) return firstString(record[0]);
  if (!record || typeof record !== 'object') return '';
  return firstString(record.name, record.title, record.productName);
}

function classifyRecord(record) {
  const name = recordName(record);
  const category = !Array.isArray(record) && record && typeof record === 'object'
    ? firstString(record.category)
    : '';
  const normalizedCategory = category.toLowerCase();

  // Catalog categories take priority so accessories such as "MacBook case"
  // remain in other instead of being mistaken for a MacBook product.
  if (normalizedCategory) {
    if (normalizedCategory === 'ipad') return 'ipad';
    if (normalizedCategory === 'iphone') return 'iphone';
    if (normalizedCategory === 'mac') {
      return /\bmacbook\b|맥북/i.test(name) ? 'macbook' : 'other';
    }
    return 'other';
  }

  // user-links.js does not always carry a category, so infer from its label.
  if (/\bmacbook\b|맥북/i.test(name)) return 'macbook';
  if (/\bipad\b|아이패드/i.test(name)) return 'ipad';
  if (/\biphone\b|아이폰/i.test(name)) return 'iphone';
  return 'other';
}

function makeOutputAbsolute(args, repoRoot, group) {
  const next = [...args];
  const outputIndex = next.indexOf('--output');
  if (outputIndex >= 0) {
    const output = next[outputIndex + 1];
    if (!output) throw new Error('Missing value for --output');
    next[outputIndex + 1] = isAbsolute(output) ? output : resolve(repoRoot, output);
    return next;
  }

  const fileName = group === 'all' ? 'stock-latest.json' : `stock-latest-${group}.json`;
  next.push('--output', resolve(repoRoot, fileName));
  return next;
}

function runScanner(scannerPath, cwd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [scannerPath, ...args], {
      cwd,
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Stock checker terminated by signal ${signal}`));
      else resolvePromise(code ?? 1);
    });
  });
}

async function main() {
  const { group, passthrough } = parseGroupArgs(process.argv.slice(2));
  const thisFile = fileURLToPath(import.meta.url);
  const scriptsDir = dirname(thisFile);
  const repoRoot = resolve(scriptsDir, '..');
  const scannerPath = resolve(scriptsDir, 'check-stock.mjs');
  const scannerArgs = makeOutputAbsolute(passthrough, repoRoot, group);

  if (passthrough.includes('--help') || passthrough.includes('-h')) {
    console.log(`\nGroup filter:\n  --group NAME          all | macbook | ipad | iphone | other (default: all)\n`);
  }

  if (group === 'all') {
    const exitCode = await runScanner(scannerPath, repoRoot, scannerArgs);
    process.exitCode = exitCode;
    return;
  }

  const catalog = await loadJsArray(resolve(repoRoot, 'catalog-data.js'), 'RETURN_MARKET_DEFAULT_PRODUCTS');
  const userLinks = await loadJsArray(resolve(repoRoot, 'user-links.js'), 'RETURN_MARKET_USER_LINKS');
  const filteredCatalog = catalog.filter((record) => classifyRecord(record) === group);
  const filteredUserLinks = userLinks.filter((record) => classifyRecord(record) === group);

  console.log(
    `Group ${group}: ${filteredCatalog.length}/${catalog.length} catalog rows, ` +
      `${filteredUserLinks.length}/${userLinks.length} user-link rows.`,
  );

  const workDir = await mkdtemp(join(tmpdir(), `apple-return-market-${group}-`));
  try {
    await writeFile(
      resolve(workDir, 'catalog-data.js'),
      `window.RETURN_MARKET_DEFAULT_PRODUCTS = ${JSON.stringify(filteredCatalog)};\n`,
      'utf8',
    );
    await writeFile(
      resolve(workDir, 'user-links.js'),
      `window.RETURN_MARKET_USER_LINKS = ${JSON.stringify(filteredUserLinks)};\n`,
      'utf8',
    );

    const exitCode = await runScanner(scannerPath, workDir, scannerArgs);
    process.exitCode = exitCode;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
