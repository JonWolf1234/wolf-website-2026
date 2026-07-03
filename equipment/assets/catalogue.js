(() => {
  'use strict';

  const state = {
    products: [],
    hierarchy: [],
    filtered: [],
    visibleCount: 24,
    pageSize: 24,
    query: '',
    department: '',
    category: '',
    subcategory: '',
    sort: 'recommended'
  };

  const els = {};
  const esc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  const normalise = value => String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  function readParams() {
    const params = new URLSearchParams(window.location.search);
    state.query = params.get('q') || '';
    state.department = params.get('department') || '';
    state.category = params.get('category') || '';
    state.subcategory = params.get('subcategory') || '';
    state.sort = params.get('sort') || 'recommended';
  }

  function writeParams() {
    const params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.department) params.set('department', state.department);
    if (state.category) params.set('category', state.category);
    if (state.subcategory) params.set('subcategory', state.subcategory);
    if (state.sort !== 'recommended') params.set('sort', state.sort);
    const query = params.toString();
    history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
  }

  function productMatches(product) {
    if (state.department && product.department !== state.department) return false;
    if (state.category && product.category !== state.category) return false;
    if (state.subcategory && product.subcategory !== state.subcategory) return false;

    if (state.query) {
      const terms = normalise(state.query).split(/\s+/).filter(Boolean);
      return terms.every(term => product.search.includes(term));
    }
    return true;
  }

  function applyFilters() {
    let products = state.products.filter(productMatches);
    if (state.sort === 'name-asc') {
      products.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    } else if (state.sort === 'name-desc') {
      products.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
    } else {
      products.sort((a, b) => (a.menuOrder - b.menuOrder) || (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    }
    state.filtered = products;
    state.visibleCount = state.pageSize;
    writeParams();
    render();
  }

  function productCard(product) {
    return `
      <article class="product-card">
        <a class="product-card-link" href="${esc(product.url)}">
          <div class="product-image-wrap">
            <img src="${esc(product.image)}" alt="${esc(product.name)}" loading="lazy" width="800" height="600">
          </div>
          <div class="product-card-body">
            <div class="product-meta">${esc(product.subcategory || product.category)}</div>
            <h3>${esc(product.name)}</h3>
            <div class="product-card-footer">
              <span>${esc(product.department)}</span>
              <span class="product-arrow" aria-hidden="true">→</span>
            </div>
          </div>
        </a>
      </article>`;
  }

  function renderGrid() {
    const products = state.filtered.slice(0, state.visibleCount);
    els.grid.innerHTML = products.length
      ? products.map(productCard).join('')
      : `<div class="empty-state"><h3>No matching equipment</h3><p>Try a broader search or clear the current filters.</p></div>`;

    els.loadMore.hidden = state.visibleCount >= state.filtered.length;
    const shown = Math.min(state.visibleCount, state.filtered.length);
    els.count.textContent = state.filtered.length
      ? `Showing ${shown.toLocaleString()} of ${state.filtered.length.toLocaleString()} products`
      : 'No products found';
  }

  function currentTitle() {
    if (state.subcategory) return state.subcategory;
    if (state.category) return state.category;
    if (state.department) return state.department;
    if (state.query) return `Search: “${state.query}”`;
    return 'All equipment';
  }

  function renderChips() {
    const chips = [];
    if (state.department) chips.push(['department', state.department]);
    if (state.category) chips.push(['category', state.category]);
    if (state.subcategory) chips.push(['subcategory', state.subcategory]);
    if (state.query) chips.push(['query', `Search: ${state.query}`]);
    els.chips.innerHTML = chips.map(([key, label]) =>
      `<button class="filter-chip" data-clear="${key}">${esc(label)} <span aria-hidden="true">×</span></button>`
    ).join('');
  }

  function renderTree() {
    const html = state.hierarchy.map(department => {
      const isOpen = !state.department || state.department === department.name;
      const categories = department.categories.map(category => {
        const categoryActive = state.category === category.name && state.department === department.name;
        const subcategories = category.subcategories.map(sub => {
          const active = state.department === department.name && state.category === category.name && state.subcategory === sub.name;
          return `<button class="subcategory-button ${active ? 'is-active' : ''}" data-department="${esc(department.name)}" data-category="${esc(category.name)}" data-subcategory="${esc(sub.name)}"><span>${esc(sub.label || sub.name)}</span><small>${sub.count}</small></button>`;
        }).join('');
        return `
          <div class="category-branch">
            <button class="category-button ${categoryActive ? 'is-active' : ''}" data-department="${esc(department.name)}" data-category="${esc(category.name)}"><span>${esc(category.name)}</span><small>${category.count}</small></button>
            <div class="subcategory-list">${subcategories}</div>
          </div>`;
      }).join('');
      return `
        <section class="department-group ${isOpen ? 'is-open' : ''}">
          <button class="department-toggle" data-department-toggle="${esc(department.name)}"><span>${esc(department.name)}</span><span>${department.count}</span></button>
          <div class="category-list">
            <button class="category-button ${state.department === department.name && !state.category ? 'is-active' : ''}" data-department="${esc(department.name)}"><span>View all</span><small>${department.count}</small></button>
            ${categories}
          </div>
        </section>`;
    }).join('');
    els.tree.innerHTML = html;
  }

  function render() {
    els.title.textContent = currentTitle();
    els.search.value = state.query;
    els.sort.value = state.sort;
    renderTree();
    renderChips();
    renderGrid();
  }

  function setCategory({ department = '', category = '', subcategory = '' }) {
    state.department = department;
    state.category = category;
    state.subcategory = subcategory;
    closeMobileFilters();
    applyFilters();
  }

  function clearFilter(key) {
    if (key === 'department') {
      state.department = '';
      state.category = '';
      state.subcategory = '';
    } else if (key === 'category') {
      state.category = '';
      state.subcategory = '';
    } else if (key === 'subcategory') {
      state.subcategory = '';
    } else if (key === 'query') {
      state.query = '';
    }
    applyFilters();
  }

  function openMobileFilters() {
    els.sidebar.classList.add('is-open');
    els.backdrop.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function closeMobileFilters() {
    els.sidebar.classList.remove('is-open');
    els.backdrop.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function bindEvents() {
    let searchTimer;
    els.search.addEventListener('input', event => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.query = event.target.value.trim();
        applyFilters();
      }, 160);
    });
    els.sort.addEventListener('change', event => {
      state.sort = event.target.value;
      applyFilters();
    });
    els.loadMore.addEventListener('click', () => {
      state.visibleCount += state.pageSize;
      renderGrid();
    });
    els.clear.addEventListener('click', () => {
      state.query = '';
      state.department = '';
      state.category = '';
      state.subcategory = '';
      applyFilters();
    });
    els.tree.addEventListener('click', event => {
      const toggle = event.target.closest('[data-department-toggle]');
      if (toggle) {
        toggle.closest('.department-group').classList.toggle('is-open');
        return;
      }
      const button = event.target.closest('[data-department]');
      if (!button) return;
      setCategory({
        department: button.dataset.department || '',
        category: button.dataset.category || '',
        subcategory: button.dataset.subcategory || ''
      });
    });
    els.chips.addEventListener('click', event => {
      const chip = event.target.closest('[data-clear]');
      if (chip) clearFilter(chip.dataset.clear);
    });
    els.filterButton.addEventListener('click', openMobileFilters);
    els.backdrop.addEventListener('click', closeMobileFilters);
    window.addEventListener('keydown', event => { if (event.key === 'Escape') closeMobileFilters(); });
  }

  async function init() {
    Object.assign(els, {
      grid: document.querySelector('[data-product-grid]'),
      tree: document.querySelector('[data-category-tree]'),
      search: document.querySelector('[data-search]'),
      sort: document.querySelector('[data-sort]'),
      count: document.querySelector('[data-results-count]'),
      title: document.querySelector('[data-results-title]'),
      chips: document.querySelector('[data-active-filters]'),
      loadMore: document.querySelector('[data-load-more]'),
      clear: document.querySelector('[data-clear-all]'),
      sidebar: document.querySelector('[data-sidebar]'),
      filterButton: document.querySelector('[data-filter-button]'),
      backdrop: document.querySelector('[data-filter-backdrop]')
    });

    try {
      const response = await fetch('./data/catalogue.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Catalogue request failed: ${response.status}`);
      const data = await response.json();
      state.products = data.products;
      state.hierarchy = data.hierarchy;
      state.pageSize = data.config.productsPerPage || 24;
      readParams();
      bindEvents();
      applyFilters();
    } catch (error) {
      console.error(error);
      els.grid.innerHTML = `<div class="empty-state"><h3>Catalogue could not be loaded</h3><p>Run the catalogue build, then view the website through a local web server rather than opening the HTML file directly.</p></div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
