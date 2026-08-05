(() => {
  'use strict';

  const STORAGE_KEY = 'return-market-catalog-v1';
  const SEEDED_KEY = 'return-market-seeded-version';
  const USER_LINK_VERSION = 'dcinside-ipad1-1033696-user-links-v8';
  const CATALOG_VERSION = 'coupang-apple-return-market-2026-08-05-v3';
  const sourceUrl = 'https://pages.coupang.com/p/163488?sourceType=oms_share';
  const DEFAULT_PRODUCTS = Array.isArray(window.RETURN_MARKET_DEFAULT_PRODUCTS) ? window.RETURN_MARKET_DEFAULT_PRODUCTS : [];
  const USER_LINKS = Array.isArray(window.RETURN_MARKET_USER_LINKS) ? window.RETURN_MARKET_USER_LINKS : [];
  const $ = (selector) => document.querySelector(selector);
  const currency = new Intl.NumberFormat('ko-KR');
  function productCategory(name, category = '') {
    const current = String(category).replace(/^댓글 제보(?:\s*·\s*)?/, '').trim();
    if (['아이폰', '아이패드', '맥', '애플워치', '에어팟', '액세서리'].includes(current)) return current;
    const text = String(name).toLowerCase();
    if (/매직|magic keyboard|trackpad|트랙패드|펜슬|pencil|폴리오|케이스|케이블|밀레니즈/.test(text)) return '액세서리';
    if (/airpods|에어팟/.test(text)) return '에어팟';
    if (/watch|워치/.test(text)) return '애플워치';
    if (/iphone|아이폰/.test(text)) return '아이폰';
    if (/ipad|아이패드|패드|스탠다드 글래스/.test(text)) return '아이패드';
    if (/macbook|맥북|맥미니|맥 미니|맥 네오/.test(text)) return '맥';
    return '액세서리';
  }
  function cleanProductNote(note) {
    return String(note || '')
      .replace(/DCInside 댓글 제보 링크\.\s*구매 전 최종 상품 페이지와 현재 가격을 확인하세요\.?/g, '')
      .split(/\s+(?:제보 )?원문 링크:/)[0]
      .trim();
  }
  let products = loadProducts();
  if (localStorage.getItem(SEEDED_KEY) !== CATALOG_VERSION) {
    const existing = new Map(products.map((product) => [product.id, product]));
    const defaults = structuredClone(DEFAULT_PRODUCTS).map((product) => ({ ...product, favorite: Boolean(existing.get(product.id)?.favorite) }));
    const customProducts = products.filter((product) => !product.id.startsWith('coupang-'));
    products = [...defaults, ...customProducts];
    localStorage.setItem(SEEDED_KEY, CATALOG_VERSION);
    saveProducts();
  }
  if (localStorage.getItem(USER_LINK_VERSION) !== 'true') {
    const officialProductIds = new Set(DEFAULT_PRODUCTS.map((product) => product.url.match(/\/vp\/products\/(\d+)/)?.[1]).filter(Boolean));
    const legacyGenericNames = new Set([
      '미확인 product 8179312949',
      '매직 키보드 11 신형 · productId 8179163270',
      '매직 트랙패드 · productId 8527859660',
      '단축 링크 · ftlA7UTZT2',
      '단축 링크 · e6bY9b2Lg4',
      '단축 링크 · eSDmqlO6nc',
      '단축 링크 · eSDoTkN2MS',
      '단축 링크 · eamO5AzJ4S',
      '단축 링크 · d1MM2AnOIS',
      '단축 링크 · eDW3GE',
      '단축 링크 · emcg2NwG5Y',
      '단축 링크 · ehlTgLCP9M'
    ]);
    products = products.filter((product) => !legacyGenericNames.has(product.name));
    products.forEach((product) => {
      if (String(product.category).startsWith('댓글 제보')) product.category = productCategory(product.name, product.category);
      product.note = cleanProductNote(product.note);
    });
    const normalizedUserLinks = USER_LINKS.map((entry, index) => {
      const report = Array.isArray(entry) ? { name: entry[0], url: entry[1] } : entry;
      return {
        ...report,
        id: report.id || `dcinside-report-${index + 1}`,
        productId: report.productId || report.url?.match(/\/vp\/products\/(\d+)/)?.[1] || '',
        sourceUrls: Array.isArray(report.sourceUrls) ? report.sourceUrls : []
      };
    });
    const existingUrls = new Set(products.map((product) => product.url));
    const reports = normalizedUserLinks.map((report) => {
      return {
        id: report.id,
        name: report.name,
        category: productCategory(report.name, report.category),
        status: report.status || 'watching',
        salePrice: Number(report.salePrice) || 0,
        originalPrice: Number(report.originalPrice) || 0,
        url: report.url,
        imageUrl: report.imageUrl || '',
        note: cleanProductNote(report.note),
        favorite: false,
        updatedAt: report.updatedAt || '2026-08-05T13:00:00.000Z',
        productId: report.productId,
        itemId: report.itemId || '',
        vendorItemId: report.vendorItemId || '',
        sourceUrls: report.sourceUrls
      };
    }).filter((report) => report.name && report.url && !existingUrls.has(report.url) && !officialProductIds.has(report.productId));
    products.push(...reports);
    localStorage.setItem(USER_LINK_VERSION, 'true');
    saveProducts();
  }
  let favoritesOnly = false;
  let visibleLimit = 80;

  function now() { return new Date().toISOString(); }
  function id() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
  function loadProducts() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(stored) ? stored : structuredClone(DEFAULT_PRODUCTS);
    } catch { return structuredClone(DEFAULT_PRODUCTS); }
  }
  function saveProducts() { localStorage.setItem(STORAGE_KEY, JSON.stringify(products)); }
  function escape(value) { const node = document.createElement('span'); node.textContent = value || ''; return node.innerHTML; }
  function statusLabel(status) { return ({ available: '확인 가능', watching: '가격 관찰', sold: '품절 / 종료' })[status] || '확인 필요'; }
  function dateLabel(value) { if (!value) return '-'; return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(new Date(value)); }
  function price(value) { return Number(value) > 0 ? `${currency.format(Number(value))}원` : '가격 미기록'; }
  function discount(product) { const original = Number(product.originalPrice), sale = Number(product.salePrice); return original > sale && sale > 0 ? Math.round((1 - sale / original) * 100) : 0; }
  function validUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:'; } catch { return false; } }

  function populateCategories() {
    const chosen = $('#categoryFilter').value || 'all';
    const preferred = ['아이폰', '아이패드', '맥', '애플워치', '에어팟', '액세서리'];
    const categories = preferred.filter((category) => products.some((product) => product.category === category));
    const options = [{ value: 'all', label: '전체', count: products.length }, ...categories.map((category) => ({ value: category, label: category, count: products.filter((product) => product.category === category).length }))];
    $('#categoryBar').innerHTML = options.map((option) => `<button type="button" class="category-tab${chosen === option.value ? ' active' : ''}" data-category="${escape(option.value)}" aria-pressed="${chosen === option.value}">${escape(option.label)} <span>${currency.format(option.count)}</span></button>`).join('');
  }

  function visibleProducts() {
    const query = $('#searchInput').value.trim().toLowerCase();
    const category = $('#categoryFilter').value;
    const status = $('#statusFilter').value;
    const sort = $('#sortSelect').value;
    const filtered = products.filter((product) => {
      const text = [product.name, product.category, product.note, product.url, product.productId, product.itemId, product.vendorItemId].join(' ').toLowerCase();
      return (!query || text.includes(query)) && (category === 'all' || product.category === category) && (status === 'all' || product.status === status) && (!favoritesOnly || product.favorite);
    });
    return filtered.sort((a, b) => {
      if (sort === 'price-low') return (Number(a.salePrice) || Infinity) - (Number(b.salePrice) || Infinity);
      if (sort === 'price-high') return (Number(b.salePrice) || 0) - (Number(a.salePrice) || 0);
      if (sort === 'discount') return discount(b) - discount(a);
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
  }

  function render() {
    populateCategories();
    const results = visibleProducts();
    const template = $('#productTemplate');
    const grid = $('#catalogGrid');
    grid.replaceChildren();
    results.slice(0, visibleLimit).forEach((product) => {
      const fragment = template.content.cloneNode(true);
      const card = fragment.querySelector('.product-card');
      const image = fragment.querySelector('img');
      image.alt = product.name;
      if (validUrl(product.imageUrl)) { image.src = product.imageUrl; image.onerror = () => image.remove(); }
      else image.remove();
      fragment.querySelector('.category').textContent = product.category || '미분류';
      const status = fragment.querySelector('.status'); status.textContent = statusLabel(product.status); status.classList.add(product.status);
      fragment.querySelector('.name').textContent = product.name;
      const note = fragment.querySelector('.note');
      if (product.note) note.textContent = product.note; else note.remove();
      fragment.querySelector('.sale-price').textContent = price(product.salePrice);
      const discountEl = fragment.querySelector('.discount'); const rate = discount(product); discountEl.textContent = rate ? `${rate}% OFF` : '';
      fragment.querySelector('.original-price').textContent = Number(product.originalPrice) ? `정가 ${price(product.originalPrice)}` : '';
      const time = fragment.querySelector('time'); time.dateTime = product.updatedAt; time.textContent = `기록 ${dateLabel(product.updatedAt)}`;
      const favorite = fragment.querySelector('.favorite-button'); favorite.classList.toggle('active', Boolean(product.favorite)); favorite.textContent = product.favorite ? '♥' : '♡'; favorite.title = product.favorite ? '찜 해제' : '찜하기'; favorite.setAttribute('aria-label', favorite.title); favorite.addEventListener('click', () => { product.favorite = !product.favorite; product.updatedAt = now(); saveProducts(); render(); });
      fragment.querySelector('.edit-button').addEventListener('click', () => openDialog(product));
      const open = fragment.querySelector('.open-button'); open.href = product.url || sourceUrl;
      grid.append(fragment);
    });
    $('#emptyState').hidden = results.length !== 0;
    const loadMore = $('#loadMoreButton');
    loadMore.hidden = results.length <= visibleLimit;
    loadMore.textContent = `상품 더 보기 (${currency.format(Math.min(80, results.length - visibleLimit))}개)`;
    $('#totalCount').textContent = currency.format(products.length);
    $('#availableCount').textContent = currency.format(products.filter((product) => product.status === 'available').length);
    $('#savedCount').textContent = currency.format(products.filter((product) => product.favorite).length);
    $('#lastUpdated').textContent = products.length ? dateLabel([...products].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0].updatedAt) : '-';
  }

  function openDialog(product) {
    const form = $('#productForm'); form.reset();
    $('#productId').value = product?.id || '';
    $('#dialogTitle').textContent = product ? '상품 수정' : '상품 추가';
    if (product) {
      $('#productName').value = product.name || ''; $('#productCategory').value = product.category || ''; $('#productStatus').value = product.status || 'available';
      $('#salePrice').value = product.salePrice || ''; $('#originalPrice').value = product.originalPrice || ''; $('#productUrl').value = product.url || ''; $('#imageUrl').value = product.imageUrl || ''; $('#productNote').value = product.note || '';
    }
    $('#productDialog').showModal(); $('#productName').focus();
  }
  function closeDialog() { $('#productDialog').close(); }

  function toCsvValue(value) { const string = String(value ?? ''); return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string; }
  function exportCsv() {
    const fields = ['name', 'category', 'status', 'salePrice', 'originalPrice', 'url', 'imageUrl', 'note', 'favorite', 'updatedAt'];
    const csv = [fields.join(','), ...products.map((product) => fields.map((field) => toCsvValue(product[field])).join(','))].join('\n');
    const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' })); anchor.download = `return-market-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(anchor.href);
  }
  function parseCsv(text) {
    const rows = []; let current = []; let value = ''; let quote = false;
    for (let i = 0; i < text.length; i += 1) { const char = text[i], next = text[i + 1]; if (char === '"' && quote && next === '"') { value += char; i += 1; } else if (char === '"') quote = !quote; else if (char === ',' && !quote) { current.push(value); value = ''; } else if ((char === '\n' || char === '\r') && !quote) { if (char === '\r' && next === '\n') i += 1; current.push(value); if (current.some(Boolean)) rows.push(current); current = []; value = ''; } else value += char; }
    if (value || current.length) { current.push(value); rows.push(current); }
    if (rows.length < 2) return [];
    const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, '').trim());
    return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])));
  }

  $('#addButton').addEventListener('click', () => openDialog());
  $('#closeDialog').addEventListener('click', closeDialog); $('#cancelDialog').addEventListener('click', closeDialog);
  $('#productForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const product = { id: $('#productId').value || id(), name: $('#productName').value.trim(), category: $('#productCategory').value.trim(), status: $('#productStatus').value, salePrice: $('#salePrice').value, originalPrice: $('#originalPrice').value, url: $('#productUrl').value.trim(), imageUrl: $('#imageUrl').value.trim(), note: $('#productNote').value.trim(), favorite: false, updatedAt: now() };
    const index = products.findIndex((item) => item.id === product.id);
    if (index >= 0) product.favorite = products[index].favorite, products[index] = product; else products.unshift(product);
    saveProducts(); closeDialog(); render();
  });
  ['searchInput', 'statusFilter', 'sortSelect'].forEach((name) => $("#" + name).addEventListener(name === 'searchInput' ? 'input' : 'change', () => { visibleLimit = 80; render(); }));
  $('#categoryBar').addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    $('#categoryFilter').value = button.dataset.category;
    visibleLimit = 80;
    render();
  });
  $('#favoritesOnly').addEventListener('click', (event) => { favoritesOnly = !favoritesOnly; visibleLimit = 80; event.currentTarget.classList.toggle('active', favoritesOnly); event.currentTarget.setAttribute('aria-pressed', String(favoritesOnly)); render(); });
  $('#loadMoreButton').addEventListener('click', () => { visibleLimit += 80; render(); });
  $('#exportButton').addEventListener('click', exportCsv);
  $('#importInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    const imported = parseCsv(await file.text()).filter((row) => row.name && validUrl(row.url)).map((row) => ({ id: id(), name: row.name, category: row.category || '미분류', status: ['available', 'watching', 'sold'].includes(row.status) ? row.status : 'watching', salePrice: row.salePrice || '', originalPrice: row.originalPrice || '', url: row.url, imageUrl: row.imageUrl || '', note: row.note || '', favorite: row.favorite === 'true', updatedAt: row.updatedAt || now() }));
    if (imported.length && confirm(`${imported.length}개 상품을 현재 목록에 추가할까요?`)) { products.unshift(...imported); saveProducts(); render(); }
    event.target.value = '';
  });
  $('#resetButton').addEventListener('click', () => { if (confirm('직접 추가하거나 수정한 내용은 사라지고, 기획전과 댓글 제보 기본 목록으로 되돌아갑니다. 계속할까요?')) { products = structuredClone(DEFAULT_PRODUCTS); saveProducts(); localStorage.removeItem(USER_LINK_VERSION); location.reload(); } });
  render();
})();
