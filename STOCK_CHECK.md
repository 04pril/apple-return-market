# Coupang return-market stock check

The web app is a historical/static snapshot. `scripts/check-stock.mjs` performs a fresh browser-based check without overwriting `catalog-data.js`.

## Local run

```bash
npm install
npx playwright install chromium
npm run stock:check -- --all
```

A smaller validation run:

```bash
npm run stock:check -- --limit 20
```

Resume an interrupted scan:

```bash
npm run stock:check -- --all --resume
```

## Product groups

The checker can scan one mutually exclusive group instead of the whole catalog:

```bash
npm run stock:check -- --group macbook --all
npm run stock:check -- --group ipad --all
npm run stock:check -- --group iphone --all
npm run stock:check -- --group other --all
```

Accepted values are `all`, `macbook`, `ipad`, `iphone`, and `other`.

- `macbook`: MacBook products only.
- `ipad`: iPad products.
- `iphone`: iPhone products.
- `other`: everything else, including iMac/Mac mini/Mac Studio, Apple Watch, AirPods, and accessories.

Catalog category metadata takes priority over name matching, so an accessory whose title contains `MacBook` remains in `other` instead of being treated as a MacBook.

When no explicit `--output` is supplied, grouped local runs write `stock-latest-macbook.json`, `stock-latest-ipad.json`, `stock-latest-iphone.json`, or `stock-latest-other.json`. A full `all` scan keeps using `stock-latest.json`.

Useful options:

```text
--group NAME       all | macbook | ipad | iphone | other (default: all)
--concurrency N   browser workers, default 4 in GitHub Actions (max 8)
--delay-ms N      minimum delay per worker, default 1000 ms in GitHub Actions
--timeout-ms N    navigation timeout, default 30000 ms
--output PATH     output JSON
--catalog-only    ignore additions from user-links.js
--headful         show Chromium for debugging
```

## Status semantics

The result deliberately uses three states:

- `available`: the current page provides positive evidence that a return/used offer can be purchased.
- `sold_out`: the current page explicitly reports a sold-out/unavailable state.
- `unknown`: the state cannot be proved, including HTTP 403/429, challenge pages, navigation errors, or ambiguous product pages.

`403`, `429`, CAPTCHA/challenge pages, and generic loading failures are **never** counted as sold out.

When a historical row has `vendorItemId`, that exact offer is checked preferentially. Rows that only have a `productId` are reported as `available` only when the page visibly contains a return-market condition (for example `반품 - 최상`, `반품 - 상`, `반품 - 중`, or `박스 훼손`) together with an enabled purchase control.

## iOS app capture validation

The Coupang iOS app was observed successfully calling the product-detail endpoint `2333` while the equivalent unauthenticated PC probes returned HTTP 403. For a successful `2333` JSON response, the stock/return signals are available together under:

`rData.properties.pageSession.logging.bypass.exposureSchema.mandatory`

Two independently captured return offers established the exact-offer mapping used by the response parser:

- exact `vendorItemId` + returned/`USED` offer + `soldOut=true` -> `sold_out`
- exact `vendorItemId` + returned/`USED` offer + `soldOut=false` -> `available`

`isAlmostOOS=true` means the offer is nearly out of stock, not sold out.

A saved raw `2333` response can be sanitized with:

```bash
npm run stock:parse-response -- --input response.json --vendor-item-id 123456789
```

A full exported mitmproxy flow dump, or a ZIP containing one, can be parsed offline without copying request headers/cookies/tokens/signatures into the output:

```powershell
py scripts/parse-coupang-mitm-flow.py "TalkFile_flows (1).zip"
```

Raw flow captures contain authenticated app traffic and must remain local. The repository `.gitignore` excludes common capture/output filenames for this reason.

## GitHub Actions: Windows self-hosted runner

GitHub-hosted Actions runners received HTTP 403 from Coupang for every target, so the stock workflow intentionally runs only on a Windows x64 self-hosted runner. The Actions UI still provides the same `group`, `limit`, `concurrency`, and `delay_ms` controls; only the machine performing the scan changes.

### One-time runner registration

On the repository page, open:

`Settings > Actions > Runners > New self-hosted runner`

Choose **Windows** and **x64**. GitHub will generate a short set of PowerShell commands containing a temporary registration token. Run those exact commands in an empty folder on the Windows PC that should perform the scans.

A typical folder is:

```powershell
mkdir C:\actions-runner
cd C:\actions-runner
```

Then run the download, extraction, and `config.cmd` commands shown by GitHub. Keep the default labels; the workflow expects the automatic labels `self-hosted`, `Windows`, and `X64`.

To test interactively, start the runner with:

```powershell
.\run.cmd
```

Leave that window open and trigger the workflow from `Actions > Check Coupang return-market stock > Run workflow`.

### Optional: run it as a Windows service

If the PC should accept scans without keeping a terminal open, configure the runner as a service using the service commands provided by the GitHub runner package after registration. Run the service setup from an elevated PowerShell/Command Prompt, then verify in the repository's `Settings > Actions > Runners` page that the runner is `Idle` before launching a scan.

### Running a scan

Open `Actions > Check Coupang return-market stock > Run workflow`, then choose for example:

- `group = iphone`
- `limit = 0`
- `concurrency = 4`
- `delay_ms = 1000`

The default group is `iphone` because it is usually the most useful quick scan. Choose `all` when a full catalog refresh is needed.

Each run uploads `stock-latest.json` as a group-labelled artifact such as `coupang-stock-iphone-latest`, `coupang-stock-macbook-latest`, or `coupang-stock-all-latest`.
