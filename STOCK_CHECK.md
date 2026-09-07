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

Useful options:

```text
--concurrency N   browser workers, default 2 (max 8)
--delay-ms N      minimum delay per worker, default 1500 ms
--timeout-ms N    navigation timeout, default 30000 ms
--output PATH     output JSON, default stock-latest.json
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

`.github/workflows/stock-check.yml` supports a manual full scan. It also runs once when the workflow file itself is first merged to `main`, so the initial installation produces a real scan artifact without committing the generated result into the repository.

The workflow uploads `stock-latest.json` as the `coupang-stock-latest` artifact.
