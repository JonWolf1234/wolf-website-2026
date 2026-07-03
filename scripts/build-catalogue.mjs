import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const args = new Set(process.argv.slice(2));
const shouldDownloadImages = args.has('--download-images') && !args.has('--skip-images');
const refreshImages = args.has('--refresh-images');

const paths = {
  input: path.join(rootDir, 'private-import', 'current-products.csv'),
  rules: path.join(rootDir, 'data', 'category-rules.csv'),
  overrides: path.join(rootDir, 'data', 'product-overrides.csv'),
  order: path.join(rootDir, 'data', 'category-order.csv'),
  config: path.join(rootDir, 'data', 'catalogue-config.json'),
  output: path.join(rootDir, 'equipment'),
  images: path.join(rootDir, 'equipment', 'assets', 'images', 'products'),
  report: path.join(rootDir, 'reports', 'catalogue-report.csv')
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  const nonEmpty = rows.filter(values => values.some(value => String(value).trim() !== ''));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0].map((value, index) => index === 0 ? value.replace(/^\uFEFF/, '') : value);
  return nonEmpty.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function makeCsv(headers, rows) {
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n') + '\n';
}

function yes(value) {
  return ['yes', 'true', '1', 'y'].includes(String(value || '').trim().toLowerCase());
}

function clean(value) {
  return String(value ?? '').trim();
}

function normalise(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function slugify(value) {
  return normalise(value).replace(/\s+/g, '-').replace(/^-+|-+$/g, '') || 'product';
}

function splitAlternatives(value) {
  return clean(value).split('|').map(normalise).filter(Boolean);
}

function matchesRule(row, rule) {
  if (!yes(rule.enabled)) return false;
  const group = normalise(row['Product Group']);
  const name = normalise(row.Name);
  const tags = normalise(row.Tags);
  const exactGroup = normalise(rule.current_rms_group);
  if (exactGroup && group !== exactGroup) return false;

  const includes = splitAlternatives(rule.name_contains);
  if (includes.length && !includes.some(term => name.includes(term))) return false;

  const excludes = splitAlternatives(rule.name_excludes);
  if (excludes.some(term => name.includes(term))) return false;

  const tagIncludes = splitAlternatives(rule.tags_contains);
  if (tagIncludes.length && !tagIncludes.some(term => tags.includes(term))) return false;

  return true;
}

function autoSortOrder(name) {
  const text = clean(name).toLowerCase();
  let match = text.match(/^\s*(\d+(?:\.\d+)?)\s*m\b/);
  if (match) return Math.round(Number(match[1]) * 1000);
  match = text.match(/^\s*(\d+(?:\.\d+)?)\s*ft\b/);
  if (match) return Math.round(Number(match[1]) * 304.8);
  match = text.match(/^\s*(\d+(?:\.\d+)?)\s*mm\b/);
  if (match) return Math.round(Number(match[1]));
  return 800000;
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function orderKey(department, category, subcategory) {
  return [department, category, subcategory].map(normalise).join('::');
}

function buildOrderMaps(orderRows) {
  const exact = new Map();
  const departmentOrders = new Map();
  const categoryOrders = new Map();

  for (const row of orderRows) {
    if (!yes(row.active)) continue;
    const department = clean(row.department);
    const category = clean(row.category);
    const subcategory = clean(row.subcategory);
    const departmentOrder = numberOr(row.department_order, 999);
    const categoryOrder = numberOr(row.category_order, 999);
    const subcategoryOrder = numberOr(row.subcategory_order, 999);
    exact.set(orderKey(department, category, subcategory), {
      departmentOrder,
      categoryOrder,
      subcategoryOrder,
      menuLabel: clean(row.menu_label) || subcategory
    });
    const depKey = normalise(department);
    const catKey = `${depKey}::${normalise(category)}`;
    departmentOrders.set(depKey, Math.min(departmentOrders.get(depKey) ?? 999, departmentOrder));
    categoryOrders.set(catKey, Math.min(categoryOrders.get(catKey) ?? 999, categoryOrder));
  }
  return { exact, departmentOrders, categoryOrders };
}

function classify(row, rules, override, config) {
  const rule = rules.find(candidate => matchesRule(row, candidate));
  let websiteVisible = clean(row.Active).toLowerCase() === 'yes';
  let department = rule ? clean(rule.website_department) : clean(row['Product Group']);
  let category = rule ? clean(rule.website_category) : '';
  let subcategory = rule ? clean(rule.website_subcategory) : '';
  let name = clean(row.Name);
  let sortOrder = autoSortOrder(name);
  let classificationSource = rule ? `Rule ${clean(rule.priority)}` : 'Fallback';

  if (!department) department = config.fallbackDepartment;
  if (!category) category = config.fallbackCategory;
  if (!subcategory) subcategory = config.fallbackSubcategory;

  if (override) {
    if (clean(override.website_visible)) websiteVisible = yes(override.website_visible);
    if (clean(override.website_department)) department = clean(override.website_department);
    if (clean(override.website_category)) category = clean(override.website_category);
    if (clean(override.website_subcategory)) subcategory = clean(override.website_subcategory);
    if (clean(override.override_display_name)) name = clean(override.override_display_name);
    if (clean(override.sort_order)) sortOrder = numberOr(override.sort_order, sortOrder);
    classificationSource = 'Product override';
  }

  const unclassified = classificationSource === 'Fallback';
  if (!config.includeUnclassified && unclassified) websiteVisible = false;
  return { websiteVisible, department, category, subcategory, name, sortOrder, classificationSource, unclassified };
}

async function ensureDir(directory) {
  await fs.mkdir(directory, { recursive: true });
}

function extensionFromContentType(contentType = '') {
  const type = contentType.split(';')[0].trim().toLowerCase();
  return ({
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif'
  })[type] || '.jpg';
}

async function existingImageFilename(id) {
  try {
    const files = await fs.readdir(paths.images);
    return files.find(file => file.startsWith(`${id}.`)) || '';
  } catch {
    return '';
  }
}

let sharpModule;
let sharpChecked = false;
async function getSharp() {
  if (sharpChecked) return sharpModule;
  sharpChecked = true;
  try {
    sharpModule = (await import('sharp')).default;
  } catch {
    sharpModule = null;
  }
  return sharpModule;
}

async function downloadImage(product, config) {
  const id = clean(product.id);
  const current = await existingImageFilename(id);
  if (current && !refreshImages) return { filename: current, status: 'Cached' };
  if (!shouldDownloadImages) return { filename: current, status: current ? 'Cached' : 'Missing' };
  if (!product.imageUrl) return { filename: current, status: current ? 'Cached' : 'Missing URL' };

  try {
    const response = await fetch(product.imageUrl, {
      headers: { 'User-Agent': 'Wolf-Equipment-Catalogue/1.0' },
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const sharp = await getSharp();

    if (sharp) {
      const filename = `${id}.webp`;
      const target = path.join(paths.images, filename);
      await sharp(buffer)
        .rotate()
        .resize({ width: config.imageMaxSize, height: config.imageMaxSize, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: config.imageQuality })
        .toFile(target);
      if (current && current !== filename) await fs.rm(path.join(paths.images, current), { force: true });
      return { filename, status: 'Downloaded and optimised' };
    }

    const extension = extensionFromContentType(response.headers.get('content-type') || '');
    const filename = `${id}${extension}`;
    await fs.writeFile(path.join(paths.images, filename), buffer);
    if (current && current !== filename) await fs.rm(path.join(paths.images, current), { force: true });
    return { filename, status: 'Downloaded (not optimised)' };
  } catch (error) {
    return { filename: current, status: `Image failed: ${error.message}` };
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const output = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      output[current] = await mapper(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

function buildHierarchy(products, orderMaps) {
  const departments = new Map();
  for (const product of products) {
    if (!departments.has(product.department)) departments.set(product.department, new Map());
    const categories = departments.get(product.department);
    if (!categories.has(product.category)) categories.set(product.category, new Map());
    const subcategories = categories.get(product.category);
    if (!subcategories.has(product.subcategory)) subcategories.set(product.subcategory, []);
    subcategories.get(product.subcategory).push(product);
  }

  return [...departments.entries()].map(([department, categoryMap]) => {
    const depOrder = orderMaps.departmentOrders.get(normalise(department)) ?? 999;
    const categories = [...categoryMap.entries()].map(([category, subMap]) => {
      const categoryOrder = orderMaps.categoryOrders.get(`${normalise(department)}::${normalise(category)}`) ?? 999;
      const subcategories = [...subMap.entries()].map(([subcategory, items]) => {
        const exact = orderMaps.exact.get(orderKey(department, category, subcategory));
        return {
          name: subcategory,
          label: exact?.menuLabel || subcategory,
          order: exact?.subcategoryOrder ?? 999,
          count: items.length
        };
      }).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, undefined, { numeric: true }));
      return {
        name: category,
        order: categoryOrder,
        count: subcategories.reduce((sum, item) => sum + item.count, 0),
        subcategories
      };
    }).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, undefined, { numeric: true }));
    return {
      name: department,
      order: depOrder,
      count: categories.reduce((sum, item) => sum + item.count, 0),
      categories
    };
  }).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function productMenuOrder(product, orderMaps) {
  const exact = orderMaps.exact.get(orderKey(product.department, product.category, product.subcategory));
  const dep = exact?.departmentOrder ?? orderMaps.departmentOrders.get(normalise(product.department)) ?? 999;
  const cat = exact?.categoryOrder ?? orderMaps.categoryOrders.get(`${normalise(product.department)}::${normalise(product.category)}`) ?? 999;
  const sub = exact?.subcategoryOrder ?? 999;
  return dep * 1_000_000 + cat * 1_000 + sub;
}

function catalogueIndexHtml(config, productCount) {
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Browse ${escapeHtml(config.siteName)} equipment hire catalogue.">
  <title>${escapeHtml(config.catalogueTitle)} | ${escapeHtml(config.siteName)}</title>
  <link rel="stylesheet" href="./assets/catalogue.css">
  <script src="./assets/catalogue.js" defer></script>
</head>
<body>
  <div class="catalogue-shell">
    <header class="catalogue-header">
      <a class="catalogue-brand" href="../index.html" aria-label="${escapeHtml(config.siteName)} home"><strong>WOLF</strong><span>LIGHTING</span></a>
      <a class="catalogue-home-link" href="../index.html">Return to main website</a>
    </header>

    <section class="catalogue-hero">
      <div class="catalogue-hero-inner">
        <div class="eyebrow">${productCount.toLocaleString('en-GB')} products</div>
        <h1>${escapeHtml(config.catalogueTitle)}</h1>
        <p>${escapeHtml(config.catalogueIntro)}</p>
      </div>
    </section>

    <div class="catalogue-toolbar-wrap">
      <div class="catalogue-toolbar">
        <label class="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.4-3.4"></path></svg>
          <span class="sr-only" hidden>Search equipment</span>
          <input class="catalogue-search" data-search type="search" placeholder="Search products, brands or equipment types…" autocomplete="off">
        </label>
        <button class="toolbar-button" data-filter-button type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"></path></svg>
          Filters
        </button>
        <select class="sort-select" data-sort aria-label="Sort products">
          <option value="recommended">Recommended order</option>
          <option value="name-asc">Name A–Z</option>
          <option value="name-desc">Name Z–A</option>
        </select>
      </div>
    </div>

    <main class="catalogue-main">
      <aside class="catalogue-sidebar" data-sidebar>
        <div class="sidebar-heading"><h2>Browse equipment</h2><button class="clear-filters" data-clear-all type="button">Clear all</button></div>
        <nav class="category-tree" data-category-tree aria-label="Equipment categories"></nav>
      </aside>
      <section class="catalogue-results" aria-live="polite">
        <header class="results-head">
          <div><p class="results-kicker">Wolf equipment catalogue</p><h2 class="results-title" data-results-title>All equipment</h2></div>
          <div class="results-count" data-results-count></div>
        </header>
        <div class="active-filters" data-active-filters></div>
        <div class="product-grid" data-product-grid></div>
        <div class="load-more-wrap"><button class="load-more" data-load-more type="button">Load more equipment</button></div>
      </section>
    </main>

    <footer class="catalogue-footer"><strong>${escapeHtml(config.siteName)}</strong><br>Equipment shown is subject to availability. Contact us to discuss your production requirements.</footer>
  </div>
  <div class="mobile-filter-backdrop" data-filter-backdrop></div>
</body>
</html>`;
}

function productCardHtml(product, prefix = '../../') {
  return `<article class="product-card">
    <a class="product-card-link" href="${prefix}products/${escapeHtml(product.slug)}/">
      <div class="product-image-wrap"><img src="${prefix}${escapeHtml(product.image.replace(/^\.\//, ''))}" alt="${escapeHtml(product.name)}" loading="lazy" width="800" height="600"></div>
      <div class="product-card-body"><div class="product-meta">${escapeHtml(product.subcategory)}</div><h3>${escapeHtml(product.name)}</h3><div class="product-card-footer"><span>${escapeHtml(product.department)}</span><span class="product-arrow" aria-hidden="true">→</span></div></div>
    </a>
  </article>`;
}

function productPageHtml(product, related, config) {
  const description = clean(product.description) || `Contact ${config.siteName} for specifications, quantities and hire availability for this item.`;
  const weight = clean(product.weight);
  const tags = product.tags.length ? product.tags.slice(0, 6).join(', ') : '';
  const mailSubject = encodeURIComponent(`Equipment enquiry: ${product.name}`);
  const mailBody = encodeURIComponent(`Hello,\n\nI would like to enquire about ${product.name} (Current RMS product ID ${product.id}).\n\nPlease could you confirm availability and discuss my requirements?\n`);
  const facts = [
    ['Category', product.category],
    ['Range', product.subcategory],
    weight && Number(weight) > 0 ? ['Weight', `${weight} kg`] : null,
    tags ? ['Tags', tags] : null
  ].filter(Boolean);
  const relatedHtml = related.length ? `
    <section class="related-section">
      <header class="related-head"><div><p class="results-kicker">Same range</p><h2>Related equipment</h2></div><a href="../../?department=${encodeURIComponent(product.department)}&category=${encodeURIComponent(product.category)}&subcategory=${encodeURIComponent(product.subcategory)}">View range</a></header>
      <div class="related-grid">${related.map(item => productCardHtml(item)).join('')}</div>
    </section>` : '';

  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description.slice(0, 155))}">
  <title>${escapeHtml(product.name)} | ${escapeHtml(config.siteName)}</title>
  <link rel="stylesheet" href="../../assets/catalogue.css">
</head>
<body class="product-page">
  <header class="catalogue-header">
    <a class="catalogue-brand" href="../../../index.html" aria-label="${escapeHtml(config.siteName)} home"><strong>WOLF</strong><span>LIGHTING</span></a>
    <a class="catalogue-home-link" href="../../">Equipment catalogue</a>
  </header>
  <nav class="product-breadcrumbs" aria-label="Breadcrumb">
    <a href="../../">Equipment</a> / <a href="../../?department=${encodeURIComponent(product.department)}">${escapeHtml(product.department)}</a> / <a href="../../?department=${encodeURIComponent(product.department)}&category=${encodeURIComponent(product.category)}">${escapeHtml(product.category)}</a> / <a href="../../?department=${encodeURIComponent(product.department)}&category=${encodeURIComponent(product.category)}&subcategory=${encodeURIComponent(product.subcategory)}">${escapeHtml(product.subcategory)}</a>
  </nav>
  <main>
    <article class="product-detail">
      <div class="product-detail-image"><img src="../../${escapeHtml(product.image.replace(/^\.\//, ''))}" alt="${escapeHtml(product.name)}" width="1200" height="900"></div>
      <div class="product-detail-copy">
        <div class="eyebrow">${escapeHtml(product.subcategory)}</div>
        <h1>${escapeHtml(product.name)}</h1>
        <div class="product-description">${escapeHtml(description).replace(/\n/g, '<br>')}</div>
        <div class="product-facts">${facts.map(([label, value]) => `<div class="product-fact"><span>${escapeHtml(label)}</span>${escapeHtml(value)}</div>`).join('')}</div>
        <a class="product-enquiry" href="mailto:${escapeHtml(config.contactEmail)}?subject=${mailSubject}&body=${mailBody}">Make an enquiry</a>
      </div>
    </article>
    ${relatedHtml}
  </main>
  <footer class="catalogue-footer"><strong>${escapeHtml(config.siteName)}</strong><br>Equipment shown is subject to availability.</footer>
</body>
</html>`;
}

async function main() {
  for (const required of [paths.input, paths.rules, paths.overrides, paths.order, paths.config]) {
    if (!fsSync.existsSync(required)) throw new Error(`Required file not found: ${path.relative(rootDir, required)}`);
  }

  const [inputText, rulesText, overridesText, orderText, configText] = await Promise.all([
    fs.readFile(paths.input, 'utf8'),
    fs.readFile(paths.rules, 'utf8'),
    fs.readFile(paths.overrides, 'utf8'),
    fs.readFile(paths.order, 'utf8'),
    fs.readFile(paths.config, 'utf8')
  ]);

  const sourceRows = parseCsv(inputText);
  const rules = parseCsv(rulesText).sort((a, b) => numberOr(a.priority, 999) - numberOr(b.priority, 999));
  const overrides = new Map(parseCsv(overridesText).map(row => [clean(row.product_id), row]));
  const orderRows = parseCsv(orderText);
  const config = JSON.parse(configText);
  const orderMaps = buildOrderMaps(orderRows);

  if (!sourceRows.length) throw new Error('The Current RMS export contains no products.');
  const ids = new Set();
  for (const row of sourceRows) {
    const id = clean(row.Id);
    if (!id) throw new Error(`A product is missing its Current RMS Id: ${clean(row.Name)}`);
    if (ids.has(id)) throw new Error(`Duplicate Current RMS product Id: ${id}`);
    ids.add(id);
  }

  await ensureDir(paths.images);
  await ensureDir(path.join(paths.output, 'assets'));
  await ensureDir(path.join(paths.output, 'data'));
  await ensureDir(path.dirname(paths.report));
  await fs.rm(path.join(paths.output, 'products'), { recursive: true, force: true });
  await ensureDir(path.join(paths.output, 'products'));

  const candidates = sourceRows.map(row => {
    const classification = classify(row, rules, overrides.get(clean(row.Id)), config);
    return {
      id: clean(row.Id),
      source: row,
      imageUrl: clean(row['Image Url']),
      ...classification
    };
  });

  const publicCandidates = candidates.filter(product => product.websiteVisible);
  console.log(`Processing ${publicCandidates.length} public products from ${sourceRows.length} Current RMS rows…`);

  const imageResults = await mapWithConcurrency(publicCandidates, 5, product => downloadImage(product, config));
  const products = publicCandidates.map((candidate, index) => {
    const imageResult = imageResults[index];
    const slug = `${slugify(candidate.name)}-${candidate.id}`;
    const image = imageResult.filename ? `./assets/images/products/${imageResult.filename}` : './assets/placeholder.svg';
    const tags = clean(candidate.source.Tags).split(',').map(clean).filter(Boolean);
    const item = {
      id: candidate.id,
      name: candidate.name,
      slug,
      url: `./products/${slug}/`,
      department: candidate.department,
      category: candidate.category,
      subcategory: candidate.subcategory,
      description: clean(candidate.source.Description),
      tags,
      weight: clean(candidate.source['Transport Weight (kg)'] || candidate.source.Weight),
      image,
      imageStatus: imageResult.status,
      sortOrder: candidate.sortOrder,
      classificationSource: candidate.classificationSource,
      unclassified: candidate.unclassified
    };
    item.menuOrder = productMenuOrder(item, orderMaps);
    item.search = normalise([item.name, item.department, item.category, item.subcategory, item.description, tags.join(' ')].join(' '));
    return item;
  }).sort((a, b) => a.menuOrder - b.menuOrder || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, undefined, { numeric: true }));

  const hierarchy = buildHierarchy(products, orderMaps);
  const publicJson = {
    generatedAt: new Date().toISOString(),
    config: { productsPerPage: config.productsPerPage },
    hierarchy,
    products: products.map(({ imageStatus, classificationSource, unclassified, ...product }) => product)
  };

  await Promise.all([
    fs.copyFile(path.join(rootDir, 'src', 'catalogue.css'), path.join(paths.output, 'assets', 'catalogue.css')),
    fs.copyFile(path.join(rootDir, 'src', 'catalogue.js'), path.join(paths.output, 'assets', 'catalogue.js')),
    fs.copyFile(path.join(rootDir, 'src', 'placeholder.svg'), path.join(paths.output, 'assets', 'placeholder.svg')),
    fs.writeFile(path.join(paths.output, 'data', 'catalogue.json'), JSON.stringify(publicJson), 'utf8'),
    fs.writeFile(path.join(paths.output, 'index.html'), catalogueIndexHtml(config, products.length), 'utf8'),
    fs.writeFile(path.join(paths.output, '.nojekyll'), '', 'utf8')
  ]);

  for (const product of products) {
    const related = products
      .filter(item => item.id !== product.id && item.department === product.department && item.category === product.category && item.subcategory === product.subcategory)
      .slice(0, 4);
    const productDir = path.join(paths.output, 'products', product.slug);
    await ensureDir(productDir);
    await fs.writeFile(path.join(productDir, 'index.html'), productPageHtml(product, related, config), 'utf8');
  }

  const reportHeaders = [
    'Product ID', 'Current RMS Name', 'Website Visible', 'Website Display Name',
    'Website Department', 'Website Category', 'Website Subcategory', 'Classification Source',
    'Image Status', 'Description Status', 'Review Required'
  ];
  const productById = new Map(products.map(product => [product.id, product]));
  const reportRows = candidates.map(candidate => {
    const product = productById.get(candidate.id);
    const imageStatus = product?.imageStatus || 'Not published';
    const descriptionStatus = clean(candidate.source.Description) ? 'Present' : 'Missing';
    const reviewRequired = candidate.unclassified || !clean(candidate.source.Description) || !product?.image || product.image.endsWith('placeholder.svg') ? 'Yes' : 'No';
    return [
      candidate.id, clean(candidate.source.Name), candidate.websiteVisible ? 'Yes' : 'No', candidate.name,
      candidate.department, candidate.category, candidate.subcategory, candidate.classificationSource,
      imageStatus, descriptionStatus, reviewRequired
    ];
  });
  await fs.writeFile(paths.report, makeCsv(reportHeaders, reportRows), 'utf8');

  const unclassifiedCount = products.filter(product => product.unclassified).length;
  const missingImages = products.filter(product => product.image.endsWith('placeholder.svg')).length;
  const missingDescriptions = products.filter(product => !product.description).length;
  console.log(`Built ${products.length} product pages and the searchable catalogue.`);
  console.log(`Review report: ${path.relative(rootDir, paths.report)}`);
  console.log(`Needs category review: ${unclassifiedCount}`);
  console.log(`Missing product images: ${missingImages}`);
  console.log(`Missing descriptions: ${missingDescriptions}`);
  if (shouldDownloadImages && !(await getSharp())) {
    console.log('Note: sharp is not installed, so downloaded images were not converted to WebP. Run npm install to enable optimisation.');
  }
}

main().catch(error => {
  console.error(`\nCatalogue build failed: ${error.message}`);
  process.exitCode = 1;
});
