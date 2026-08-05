(() => {
  'use strict';

  const STORAGE_KEY = 'return-market-catalog-v1';
  const SEEDED_KEY = 'return-market-seeded-version';
  const USER_LINK_VERSION = 'dcinside-ipad1-1033696-user-links-v15';
  const CATALOG_VERSION = 'coupang-apple-return-market-2026-08-05-v3';
  const sourceUrl = 'https://pages.coupang.com/p/163488?sourceType=oms_share';
  const DEFAULT_PRODUCTS = Array.isArray(window.RETURN_MARKET_DEFAULT_PRODUCTS) ? window.RETURN_MARKET_DEFAULT_PRODUCTS : [];
  const USER_LINKS = Array.isArray(window.RETURN_MARKET_USER_LINKS) ? window.RETURN_MARKET_USER_LINKS : [];
  const $ = (selector) => document.querySelector(selector);
  const currency = new Intl.NumberFormat('ko-KR');
  const RESOLVED_SHORT_LINKS = {
    e7UmsJ4oJE: ['6530455504', '14502226168', '81745237430'], e6I2Lj2bQq: ['8589676700', '24904459173', '91914627265'], e6MxMleVhc: ['8490155564', '24573333474', '91623049416'],
    eXiOQtktPM: ['8230502704', '23687001399', '91578212064'], e1GIEvlGWO: ['8622853535', '25016676576', '92277959885'], e5BGzqzibk: ['9203536772', '27176834791', '94445198726'],
    eWyL9t3hKu: ['8127283202', '23073450276', '90567200761'], eWyN0cPO68: ['8186051977', '23410821866', '90443617130'], eWoqysXSBU: ['9079380305', '26671843923', '93649369328'],
    eWosh2vwnQ: ['9119572717', '26824934981', '93829733531'], eWouos3frM: ['9079344509', '26671671646', '93643959458'], eWYshwqvvw: ['9076862955', '26661796693', '93733759075'],
    eWYtDSHkei: ['9075132541', '26655949014', '93654801365'], eWx3wIkQPA: ['9477671691', '28215566938', '95214849134'], eWx4vr4xVs: ['9477674284', '28215575770', '95269619205'],
    eWx6JnrGgK: ['9477669350', '28215559861', '95398136068'], eWx8dUXGqO: ['9522636394', '28389160656', '95340665133'], eWxScO2kGi: ['8356310374', '24145471959', '91164300544'],
    eWxTeI1Ss8: ['9475137805', '28205871011', '95166061898'], eWxX7jarSK: ['8358123856', '24152225845', '91230283798'], eWx030Q7VI: ['8364671627', '24167168939', '91320150447'],
    eWx2kbmgNg: ['8359784817', '24158547338', '91192400138'], eU98embDlR: ['8805710138', '25645695808', '93210761926'], eWxsKhWgkm: ['8545808853', '24744630891', '91753235787'],
    eWxxWlUFem: ['8805710138', '25645695808', '93210761926'], eSLLh9g7Bk: ['9153924950', '26957796330', '93926803248'], eS8QLYeiLk: ['9442854317', '28086525456', '95042909822'],
    eS8S454R76: ['9450934639', '28115213574', '95071116652'], eg7Zjk1ttc: ['8404710296', '24297237262', '91318990641'], eg87vCOKSO: ['8183985191', '23402937046', '90472256979']
  };
  const USER_LINK_OVERRIDES = {
    '6530411186': { salePrice: 77000, status: 'available', note: '반품-중, 확인 당시 쿠폰가 77,000원·재고 1개.' },
    '9079344509': { name: 'Apple 아이폰 Air 자급제 스페이스 블랙 256GB', status: 'sold', imageUrl: 'assets/products/iphone-air-space-black-256.png', note: '스페이스 블랙 × 256GB. 상품 페이지에서 품절 확인.' },
    '9079380305': { name: 'Apple 아이폰 Air 자급제 스카이 블루 256GB', status: 'sold', imageUrl: 'assets/products/iphone-air-sky-blue-256.png', note: '스카이 블루 × 256GB. 상품 페이지에서 품절 확인.' },
    '9119572717': { name: 'Apple 아이폰 Air 자급제 클라우드 화이트 256GB', status: 'available', salePrice: 1128340, originalPrice: 1359450, imageUrl: 'assets/products/iphone-air-cloud-white-256.png', note: '클라우드 화이트 × 256GB. 반품-최상(사용감 없음), 확인 당시 표시가 1,128,340원.' },
    '9205344492': { name: 'Apple 아이폰 17 자급제 화이트 256GB', status: 'sold', imageUrl: 'assets/products/iphone-17-white-256.png', note: '화이트 × 256GB. 반품-최상 링크, 확인 당시 해당 선택 옵션 품절.' },
    '9226094651': { name: 'Apple 아이폰 17 자급제 블랙 256GB', status: 'sold', imageUrl: 'assets/products/iphone-17-black-256.png', note: '블랙 × 256GB. 상품 페이지에서 품절 확인.' }
  };
  function productCategory(name, category = '') {
    const text = String(name).toLowerCase();
    const isWatchBody = /(?:apple watch|애플워치|워치)/.test(text) && /알루미늄\s*케이스/.test(text);
    const accessoryText = text.replace(/알루미늄\s*케이스/g, '');
    const isAccessory = !isWatchBody && /(?:case|케이스|커버|폴리오|키보드|keyboard|트랙패드|trackpad|펜슬|pencil|케이블|cable|충전기|어댑터|adapter|스트랩|밴드|밀레니즈|링크 브레이슬릿|실리콘|가죽|맥세이프|magsafe|보호필름|필름)/.test(accessoryText);
    if (isAccessory) return '액세서리';
    if (/(?:beats|비츠)/.test(text) && /(?:studio|버즈|buds|solo|fit|flex|헤드|headphone|이어폰|스피커)/.test(text)) return '비츠';
    if (/airpods|에어팟/.test(text)) return '에어팟';
    if (/watch|워치/.test(text)) return '애플워치';
    if (/iphone|아이폰/.test(text)) return '아이폰';
    if (/ipad|아이패드|패드|스탠다드 글래스/.test(text)) return '아이패드';
    if (/macbook|맥북|맥미니|맥 미니|맥 네오/.test(text)) return '맥';
    if (/매직|magic keyboard|trackpad|트랙패드|펜슬|pencil|폴리오|케이스|케이블|밀레니즈/.test(text)) return '액세서리';
    const current = String(category).replace(/^댓글 제보(?:\s*·\s*)?/, '').trim();
    if (['아이폰', '아이패드', '맥', '애플워치', '에어팟', '비츠', '액세서리'].includes(current)) return current;
    return '액세서리';
  }
  function modelSortScore(product) {
    const name = String(product.name || '').toLowerCase();
    const category = product.category;
    const year = Number(name.match(/20(2[0-9])/i)?.[0] || 0);
    if (category === '아이폰') {
      if (/air/.test(name) && !/airpods/.test(name)) return 170.5;
      const generation = Number(name.match(/아이폰\s*(1[1-7])|iphone\s*(1[1-7])/i)?.[1] || name.match(/\b(1[1-7])\s*(?:pro|promax|프로나|프로맥스|e|[\uAC00-\uD7A3])/i)?.[1] || 0);
      if (/se/.test(name)) return 50 + Number(name.match(/se\s*([23])/i)?.[1] || 0);
      return generation * 10;
    }
    if (category === '애플워치') {
      if (/ultra/.test(name)) return 120 + Number(name.match(/ultra\s*([12])/i)?.[1] || 1);
      if (/se/.test(name)) return 80 + Number(name.match(/se\s*([23])/i)?.[1] || 1);
      return Number(name.match(/(?:watch|워치)\s*(\d{1,2})/i)?.[1] || 0) * 10;
    }
    const chip = Number(name.match(/m\s*([1-5])/i)?.[1] || 0);
    const numericModel = Number(name.match(/(?:아이패드|ipad|맥북|macbook|에어팟|airpods)\s*(\d{1,2})/i)?.[1] || 0);
    return Math.max(chip * 100, year, numericModel * 10);
  }
  function cleanProductNote(note) {
    return String(note || '')
      .replace(/DCInside 댓글 제보 링크\.\s*구매 전 최종 상품 페이지와 현재 가격을 확인하세요\.?/g, '')
      .split(/\s+(?:제보 )?원문 링크:/)[0]
      .trim();
  }
  function shortSlug(url) { return String(url || '').match(/\/a\/([A-Za-z0-9]+)/)?.[1] || ''; }
  function resolvedLinkData(url) {
    const direct = String(url || '').match(/\/vp\/products\/(\d+)(?:\?[^#]*)?/);
    if (direct) {
      const query = new URL(url).searchParams;
      return [direct[1], query.get('itemId') || '', query.get('vendorItemId') || ''];
    }
    return RESOLVED_SHORT_LINKS[shortSlug(url)] || ['', '', ''];
  }
  function fallbackThumbnail(product) {
    const phoneName = String(product.name || '').toLowerCase();
    if (product.category === '아이폰' && /(air|아이폰 17)/.test(phoneName)) {
      const isAir = /air/.test(phoneName);
      const isBlack = /블랙|black/.test(phoneName);
      const isBlue = /블루|blue/.test(phoneName);
      const body = isBlack ? '#202329' : isBlue ? '#dcebf5' : '#f4f5f2';
      const edge = isBlack ? '#505762' : isBlue ? '#9eb7c5' : '#bbc2c1';
      const screen = isBlack ? '#11151a' : isBlue ? '#a9cfe7' : '#e8f0ef';
      const label = isAir ? 'iPhone Air' : 'iPhone 17';
      return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 400"><rect width="460" height="400" fill="#f3f5f1"/><ellipse cx="230" cy="346" rx="128" ry="18" fill="#cdd5d2" opacity=".6"/><g transform="translate(143 28) rotate(-9 88 170)"><rect x="0" y="0" width="176" height="338" rx="30" fill="${edge}"/><rect x="8" y="8" width="160" height="322" rx="25" fill="${body}"/><rect x="23" y="25" width="130" height="286" rx="19" fill="${screen}"/><circle cx="48" cy="55" r="20" fill="#17191d"/><circle cx="48" cy="55" r="10" fill="#5f6d76"/><circle cx="82" cy="55" r="20" fill="#17191d"/><circle cx="82" cy="55" r="10" fill="#5f6d76"/><path d="M35 225c30-32 67-32 98 0" stroke="#fff" stroke-opacity=".38" stroke-width="4" fill="none"/></g><text x="28" y="45" fill="#0b7771" font-family="Arial,sans-serif" font-size="16" font-weight="700" letter-spacing="2">${product.category}</text><text x="28" y="366" fill="#12272b" font-family="Arial,sans-serif" font-size="19" font-weight="700">${label}</text></svg>`)}`;
    }
    const colors = { 아이폰: ['#20252c', '#a9c5d8'], 아이패드: ['#2b2d34', '#c4d6d2'], 맥: ['#49515a', '#d8dce0'], 애플워치: ['#433d3a', '#d8b9a8'], 에어팟: ['#e8e9e5', '#9da7a3'], 액세서리: ['#154c4a', '#c7e3d9'] };
    const [background, accent] = colors[product.category] || colors.액세서리;
    const label = String(product.name || product.category || '상품').replace(/&/g, '&amp;').replace(/[<>]/g, '').slice(0, 24);
    const category = String(product.category || '상품');
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 400"><rect width="460" height="400" fill="${background}"/><circle cx="380" cy="65" r="120" fill="${accent}" opacity=".24"/><path d="M0 330C130 255 250 380 460 270V400H0Z" fill="${accent}" opacity=".16"/><text x="30" y="54" fill="${accent}" font-family="Arial,sans-serif" font-size="16" font-weight="700" letter-spacing="2">${category}</text><text x="30" y="210" fill="#fff" font-family="Arial,sans-serif" font-size="27" font-weight="700">${label}</text><text x="30" y="350" fill="${accent}" font-family="Georgia,serif" font-size="15">RETURN MARKET</text></svg>`)}`;
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
    const oldReportFavorites = new Map(products.filter((product) => /^(dcinside|resolved)-/.test(product.id)).map((product) => [product.url, Boolean(product.favorite)]));
    products = products.filter((product) => !legacyGenericNames.has(product.name) && !/^(dcinside|resolved)-/.test(product.id));
    products.forEach((product) => {
      product.category = productCategory(product.name, product.category);
      product.note = cleanProductNote(product.note);
    });
    const normalizedUserLinks = USER_LINKS.map((entry, index) => {
      const report = Array.isArray(entry) ? { name: entry[0], url: entry[1] } : entry;
      const [productId, itemId, vendorItemId] = resolvedLinkData(report.url);
      return {
        ...report,
        id: report.id || `dcinside-report-${index + 1}`,
        productId: report.productId || productId,
        itemId: report.itemId || itemId,
        vendorItemId: report.vendorItemId || vendorItemId,
        sourceUrls: Array.isArray(report.sourceUrls) ? report.sourceUrls : []
      };
    });
    const existingUrls = new Set(products.map((product) => product.url));
    const reports = normalizedUserLinks.map((report) => {
      const exactOfficial = DEFAULT_PRODUCTS.find((product) => report.vendorItemId && product.url.includes(`vendorItemId=${report.vendorItemId}`));
      const sameProduct = DEFAULT_PRODUCTS.find((product) => report.productId && product.url.includes(`/vp/products/${report.productId}`));
      const override = USER_LINK_OVERRIDES[report.productId] || {};
      return {
        id: report.id,
        name: override.name || report.name,
        category: productCategory(override.name || report.name, report.category),
        status: override.status || report.status || exactOfficial?.status || 'watching',
        salePrice: Number(report.salePrice) || Number(override.salePrice) || Number(exactOfficial?.salePrice) || 0,
        originalPrice: Number(report.originalPrice) || Number(exactOfficial?.originalPrice) || 0,
        url: report.url.match(/\/vp\/products\//) ? report.url : `https://www.coupang.com/vp/products/${report.productId}?itemId=${report.itemId}&vendorItemId=${report.vendorItemId}&landingType=USED_DETAIL`,
        imageUrl: override.imageUrl || report.imageUrl || exactOfficial?.imageUrl || sameProduct?.imageUrl || '',
        note: cleanProductNote(override.note || report.note),
        favorite: oldReportFavorites.get(report.url) || false,
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
  function price(value) { return Number(value) > 0 ? `${currency.format(Number(value))}원` : '상품 페이지 확인'; }
  function discount(product) { const original = Number(product.originalPrice), sale = Number(product.salePrice); return original > sale && sale > 0 ? Math.round((1 - sale / original) * 100) : 0; }
  function validUrl(value) { try { const url = new URL(value, location.href); return ['https:', 'http:', 'data:'].includes(url.protocol); } catch { return false; } }

  function populateCategories() {
    const chosen = $('#categoryFilter').value || 'all';
    const preferred = ['아이폰', '아이패드', '맥', '애플워치', '에어팟', '비츠', '액세서리'];
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
      if (sort === 'model') return modelSortScore(b) - modelSortScore(a) || a.name.localeCompare(b.name, 'ko');
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
      image.src = validUrl(product.imageUrl) ? product.imageUrl : fallbackThumbnail(product);
      image.onerror = () => { image.onerror = null; image.src = fallbackThumbnail(product); };
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
