// === Amazon Niche Finder - Frontend ===

const API = '';

// --- State ---
let currentView = 'dashboard';
let pollTimers = [];

// --- Navigation ---
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    switchView(view);
  });
});

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-view="${view}"]`).classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');

  if (view === 'dashboard') loadDashboard();
  if (view === 'niches') loadNiches();
  if (view === 'criteria') loadCriteria();
}

// --- Dashboard ---
async function loadDashboard() {
  try {
    const [stats, searches] = await Promise.all([
      fetch(`${API}/api/stats`).then(r => r.json()),
      fetch(`${API}/api/searches`).then(r => r.json()),
    ]);

    document.getElementById('stat-total-searches').textContent = stats.totalSearches;
    document.getElementById('stat-passing-niches').textContent = stats.passingNiches;
    document.getElementById('stat-total-niches').textContent = stats.totalNiches;
    document.getElementById('stat-top-score').textContent = stats.topNiche
      ? stats.topNiche.niche_score.toFixed(1)
      : '-';

    renderRecentSearches(searches.slice(0, 10));
    loadTopNiches();
  } catch (err) {
    console.error('Failed to load dashboard:', err);
  }
}

function renderRecentSearches(searches) {
  const container = document.getElementById('recent-searches');
  if (!searches.length) {
    container.innerHTML = '<p class="empty-state">No searches yet. Go to Search to get started.</p>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Keyword</th>
          <th>Status</th>
          <th>Score</th>
          <th>Search Vol.</th>
          <th>Competitors</th>
          <th>Avg Price</th>
          <th>Revenue</th>
          <th>Passes</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
        ${searches.map(s => `
          <tr>
            <td><strong>${esc(s.keyword)}</strong></td>
            <td>${statusBadge(s.status)}</td>
            <td>${s.niche_score != null ? scoreSpan(s.niche_score) : '-'}</td>
            <td>${s.search_volume != null ? num(s.search_volume) : '-'}</td>
            <td>${s.competitor_count != null ? s.competitor_count : '-'}</td>
            <td>${s.avg_price != null ? pound(s.avg_price) : '-'}</td>
            <td>${s.avg_monthly_revenue != null ? pound(s.avg_monthly_revenue) : '-'}</td>
            <td>${s.passes_criteria != null ? (s.passes_criteria ? '<span class="badge badge-pass">PASS</span>' : '<span class="badge badge-fail">FAIL</span>') : '-'}</td>
            <td>${timeAgo(s.created_at)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function loadTopNiches() {
  try {
    const niches = await fetch(`${API}/api/niches/passing`).then(r => r.json());
    const container = document.getElementById('top-niches');
    if (!niches.length) {
      container.innerHTML = '<p class="empty-state">No passing niches found yet.</p>';
      return;
    }
    renderNichesTable(container, niches.slice(0, 5));
  } catch (err) {
    console.error('Failed to load top niches:', err);
  }
}

// --- Search ---
document.getElementById('btn-search').addEventListener('click', async () => {
  const keyword = document.getElementById('search-keyword').value.trim();
  if (!keyword) return;
  await runSearch(keyword);
});

document.getElementById('search-keyword').addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const keyword = e.target.value.trim();
    if (keyword) await runSearch(keyword);
  }
});

document.getElementById('btn-bulk-search').addEventListener('click', async () => {
  const text = document.getElementById('bulk-keywords').value.trim();
  if (!text) return;
  const keywords = text.split('\n').map(k => k.trim()).filter(k => k.length > 0);
  if (!keywords.length) return;
  await runBulkSearch(keywords);
});

async function runSearch(keyword) {
  showSearchStatus('Analysing niche...');
  hideSearchResult();

  try {
    const res = await fetch(`${API}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword }),
    });
    const data = await res.json();
    pollForResult(data.searchId);
  } catch (err) {
    hideSearchStatus();
    alert('Search failed: ' + err.message);
  }
}

// --- Category Search ---
document.getElementById('category-select').addEventListener('change', (e) => {
  const wrap = document.getElementById('custom-category-wrap');
  wrap.style.display = e.target.value === 'custom' ? 'block' : 'none';
});

document.getElementById('btn-category-search').addEventListener('click', async () => {
  const select = document.getElementById('category-select');
  let categoryId, categoryName;

  if (select.value === 'custom') {
    categoryId = document.getElementById('custom-category-id').value.trim();
    categoryName = document.getElementById('custom-category-name').value.trim() || `Category ${categoryId}`;
  } else if (select.value) {
    categoryId = select.value;
    categoryName = select.options[select.selectedIndex].text;
  }

  if (!categoryId) return;

  showSearchStatus(`Analysing category: ${categoryName}...`);
  hideSearchResult();

  try {
    const res = await fetch(`${API}/api/search/category`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId, categoryName }),
    });
    const data = await res.json();
    pollForResult(data.searchId);
  } catch (err) {
    hideSearchStatus();
    alert('Category search failed: ' + err.message);
  }
});

async function runBulkSearch(keywords) {
  showSearchStatus(`Analysing ${keywords.length} keywords...`);
  hideSearchResult();

  try {
    const res = await fetch(`${API}/api/search/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords }),
    });
    const data = await res.json();

    // Poll for all results
    let completed = 0;
    for (const s of data.searches) {
      pollForResult(s.searchId, () => {
        completed++;
        document.getElementById('search-status-text').textContent =
          `Completed ${completed}/${keywords.length} keywords...`;
        if (completed === keywords.length) {
          hideSearchStatus();
          switchView('niches');
        }
      });
    }
  } catch (err) {
    hideSearchStatus();
    alert('Bulk search failed: ' + err.message);
  }
}

function pollForResult(searchId, onComplete) {
  const timer = setInterval(async () => {
    try {
      const res = await fetch(`${API}/api/search/${searchId}`);
      const data = await res.json();

      if (data.status === 'completed') {
        clearInterval(timer);
        if (onComplete) {
          onComplete(data);
        } else {
          hideSearchStatus();
          showSearchResult(data);
        }
      } else if (data.status === 'failed') {
        clearInterval(timer);
        hideSearchStatus();
        const error = data.results_json?.error || 'Unknown error';
        alert(`Search failed: ${error}`);
      }
    } catch {
      // Retry on next tick
    }
  }, 1500);
  pollTimers.push(timer);
}

function showSearchStatus(text) {
  document.getElementById('search-status').style.display = 'flex';
  document.getElementById('search-status-text').textContent = text;
}

function hideSearchStatus() {
  document.getElementById('search-status').style.display = 'none';
}

function hideSearchResult() {
  document.getElementById('search-result').style.display = 'none';
}

function showSearchResult(data) {
  const container = document.getElementById('search-result');
  container.style.display = 'block';

  const r = data.results_json;
  if (!r) {
    document.getElementById('result-content').innerHTML = '<p>No results.</p>';
    return;
  }

  const checks = r.checks || {};
  const checkLabels = {
    searchVolume: 'Search Volume 3000+',
    competitors: 'Max 35 Competitors',
    maxReviews: 'Max 1500 Reviews',
    priceRange: 'Price in Range',
    avgPriceInRange: 'Avg Price in Range',
    revenue: 'Revenue £2500+',
    margin: 'Margin 25%+',
    seasonality: '6+ Months in Season',
  };

  document.getElementById('result-content').innerHTML = `
    <div class="result-card">
      <div class="result-header">
        <h3>${esc(r.keyword)}</h3>
        <div>
          <span class="score ${scoreClass(r.nicheScore)}">${r.nicheScore}</span>/100
          ${r.passesCriteria
            ? '<span class="badge badge-pass" style="margin-left:12px">PASSES ALL CRITERIA</span>'
            : `<span class="badge badge-fail" style="margin-left:12px">FAILS (${r.passCount}/${r.totalChecks})</span>`
          }
        </div>
      </div>

      <div class="checks-grid">
        ${Object.entries(checks).map(([key, val]) => `
          <div class="check-item ${val ? 'check-pass' : 'check-fail'}">
            <span class="check-icon">${val ? '&#10003;' : '&#10007;'}</span>
            <span>${checkLabels[key] || key}</span>
          </div>
        `).join('')}
      </div>

      <div class="metrics-grid">
        <div class="metric">
          <div class="metric-value">${num(r.searchVolume)}</div>
          <div class="metric-label">Monthly Search Volume</div>
        </div>
        <div class="metric">
          <div class="metric-value">${r.competitorCount}</div>
          <div class="metric-label">Competitors</div>
        </div>
        <div class="metric">
          <div class="metric-value">${pound(r.avgPrice)}</div>
          <div class="metric-label">Avg Price</div>
        </div>
        <div class="metric">
          <div class="metric-value">${r.maxReviews}</div>
          <div class="metric-label">Max Reviews</div>
        </div>
        <div class="metric">
          <div class="metric-value">${pound(r.avgMonthlyRevenue)}</div>
          <div class="metric-label">Avg Monthly Revenue</div>
        </div>
        <div class="metric">
          <div class="metric-value">${r.estimatedMargin}%</div>
          <div class="metric-label">Est. Margin</div>
        </div>
        <div class="metric">
          <div class="metric-value">${r.seasonalityMonths}/12</div>
          <div class="metric-label">Months in Season</div>
        </div>
        <div class="metric">
          <div class="metric-value">${pound(r.totalNicheRevenue)}</div>
          <div class="metric-label">Total Niche Revenue</div>
        </div>
      </div>

      ${r.priceDistribution ? `
        <h4 style="margin-bottom:8px;">Price Distribution</h4>
        <div class="dist-bars">
          ${renderDistribution(r.priceDistribution)}
        </div>
      ` : ''}

      ${r.reviewDistribution ? `
        <h4 style="margin:16px 0 8px;">Review Distribution</h4>
        <div class="dist-bars">
          ${renderDistribution(r.reviewDistribution)}
        </div>
      ` : ''}

      ${r.topCompetitors?.length ? `
        <h4 style="margin:20px 0 8px;">Top Competitors</h4>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Price</th>
                <th>Reviews</th>
                <th>Rating</th>
                <th>Est. Monthly Sales</th>
                <th>Est. Monthly Revenue</th>
              </tr>
            </thead>
            <tbody>
              ${r.topCompetitors.map((c, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td title="${esc(c.title)}">${esc(truncate(c.title, 50))}</td>
                  <td>${c.price != null ? pound(c.price) : '-'}</td>
                  <td>${num(c.reviews)}</td>
                  <td>${c.rating != null ? c.rating.toFixed(1) : '-'}</td>
                  <td>${num(c.estimatedMonthlySales)}</td>
                  <td>${c.estimatedMonthlyRevenue != null ? pound(c.estimatedMonthlyRevenue) : '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;
}

function renderDistribution(dist) {
  const max = Math.max(...Object.values(dist), 1);
  return Object.entries(dist).map(([label, count]) => `
    <div class="dist-row">
      <span class="dist-label">${label}</span>
      <div class="dist-bar-bg">
        <div class="dist-bar" style="width:${(count / max) * 100}%"></div>
      </div>
      <span class="dist-count">${count}</span>
    </div>
  `).join('');
}

// --- Saved Niches ---
async function loadNiches() {
  const passingOnly = document.getElementById('filter-passing').checked;
  const sort = document.getElementById('sort-niches').value;

  try {
    const url = passingOnly ? `${API}/api/niches/passing` : `${API}/api/niches?sort=${sort}`;
    const niches = await fetch(url).then(r => r.json());
    const container = document.getElementById('niches-list');

    if (!niches.length) {
      container.innerHTML = '<p class="empty-state">No niches found matching your filters.</p>';
      return;
    }

    renderNichesTable(container, niches);
  } catch (err) {
    console.error('Failed to load niches:', err);
  }
}

document.getElementById('filter-passing').addEventListener('change', loadNiches);
document.getElementById('sort-niches').addEventListener('change', loadNiches);

function renderNichesTable(container, niches) {
  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Keyword</th>
          <th>Score</th>
          <th>Search Vol.</th>
          <th>Competitors</th>
          <th>Max Reviews</th>
          <th>Avg Price</th>
          <th>Revenue</th>
          <th>Margin</th>
          <th>Season</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${niches.map(n => `
          <tr>
            <td><strong>${esc(n.keyword)}</strong></td>
            <td>${scoreSpan(n.niche_score)}</td>
            <td>${num(n.search_volume)}</td>
            <td>${n.competitor_count}</td>
            <td>${num(n.max_reviews)}</td>
            <td>${pound(n.avg_price)}</td>
            <td>${pound(n.avg_monthly_revenue)}</td>
            <td>${n.estimated_margin?.toFixed(1)}%</td>
            <td>${n.seasonality_months}/12</td>
            <td>${n.passes_criteria ? '<span class="badge badge-pass">PASS</span>' : '<span class="badge badge-fail">FAIL</span>'}</td>
            <td><button class="btn btn-sm btn-danger" onclick="deleteNiche('${n.id}')">Delete</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function deleteNiche(id) {
  if (!confirm('Delete this niche?')) return;
  await fetch(`${API}/api/niches/${encodeURIComponent(id)}`, { method: 'DELETE' });
  loadNiches();
}

// Make deleteNiche available globally for onclick
window.deleteNiche = deleteNiche;

// --- API Settings ---
async function loadApiSettings() {
  try {
    const settings = await fetch(`${API}/api/settings`).then(r => r.json());
    document.getElementById('api-provider').value = settings.provider;
    document.getElementById('api-key-input').value = '';
    document.getElementById('api-key-input').placeholder = settings.hasKey
      ? `Current: ${settings.maskedKey}`
      : 'Enter your API key';
    document.getElementById('api-status').innerHTML = settings.hasKey
      ? '<span style="color:var(--success)">API key configured</span>'
      : '<span style="color:var(--danger)">No API key set</span>';
  } catch (err) {
    console.error('Failed to load API settings:', err);
  }
}

document.getElementById('btn-toggle-key').addEventListener('click', () => {
  const input = document.getElementById('api-key-input');
  const btn = document.getElementById('btn-toggle-key');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
});

document.getElementById('btn-save-api').addEventListener('click', async () => {
  const provider = document.getElementById('api-provider').value;
  const apiKey = document.getElementById('api-key-input').value.trim();

  const data = { provider };
  if (apiKey) data.api_key = apiKey;

  try {
    await fetch(`${API}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const indicator = document.getElementById('api-saved');
    indicator.style.display = 'inline';
    setTimeout(() => { indicator.style.display = 'none'; }, 2000);
    loadApiSettings();
  } catch (err) {
    alert('Failed to save API settings: ' + err.message);
  }
});

// --- Criteria ---
async function loadCriteria() {
  try {
    const [criteria] = await Promise.all([
      fetch(`${API}/api/criteria`).then(r => r.json()),
      loadApiSettings(),
    ]);
    document.getElementById('c-min-sv').value = criteria.min_search_volume;
    document.getElementById('c-max-comp').value = criteria.max_competitors;
    document.getElementById('c-max-rev').value = criteria.max_reviews;
    document.getElementById('c-min-price').value = criteria.min_price;
    document.getElementById('c-max-price').value = criteria.max_price;
    document.getElementById('c-min-rev').value = criteria.min_monthly_revenue;
    document.getElementById('c-margin').value = criteria.target_margin;
    document.getElementById('c-season').value = criteria.min_season_months;
  } catch (err) {
    console.error('Failed to load criteria:', err);
  }
}

document.getElementById('criteria-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = {
    min_search_volume: parseInt(form.min_search_volume.value),
    max_competitors: parseInt(form.max_competitors.value),
    max_reviews: parseInt(form.max_reviews.value),
    min_price: parseFloat(form.min_price.value),
    max_price: parseFloat(form.max_price.value),
    min_monthly_revenue: parseFloat(form.min_monthly_revenue.value),
    target_margin: parseFloat(form.target_margin.value),
    min_season_months: parseInt(form.min_season_months.value),
  };

  try {
    await fetch(`${API}/api/criteria`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const indicator = document.getElementById('criteria-saved');
    indicator.style.display = 'inline';
    setTimeout(() => { indicator.style.display = 'none'; }, 2000);
  } catch (err) {
    alert('Failed to save criteria: ' + err.message);
  }
});

// --- Helpers ---
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function num(n) {
  if (n == null) return '-';
  return Number(n).toLocaleString('en-GB');
}

function pound(n) {
  if (n == null) return '-';
  return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function scoreSpan(score) {
  if (score == null) return '-';
  const cls = score >= 70 ? 'score-high' : score >= 40 ? 'score-mid' : 'score-low';
  return `<span class="score ${cls}">${score.toFixed(1)}</span>`;
}

function scoreClass(score) {
  if (score >= 70) return 'score-high';
  if (score >= 40) return 'score-mid';
  return 'score-low';
}

function statusBadge(status) {
  const cls = {
    completed: 'badge-pass',
    failed: 'badge-fail',
    pending: 'badge-pending',
    processing: 'badge-processing',
  }[status] || 'badge-pending';
  return `<span class="badge ${cls}">${status}</span>`;
}

function timeAgo(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

// --- Init ---
loadDashboard();
