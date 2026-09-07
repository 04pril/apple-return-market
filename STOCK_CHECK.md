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

## GitHub Actions

`.github/workflows/stock-check.yml` supports manual scans with a `group` dropdown. Choose `all`, `macbook`, `ipad`, `iphone`, or `other`, then set the concurrency/delay values as usual.

The workflow uses `stock-latest.json` inside each individual run and uploads it as a group-labelled artifact such as `coupang-stock-iphone-latest` or `coupang-stock-macbook-latest`.
