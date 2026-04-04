import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { RainforestProvider } from './providers/rainforest.js';
import { KeepaProvider } from './providers/keepa.js';
import { NicheAnalyzer } from './analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// --- Database Setup ---
const dbPath = process.env.DATABASE_PATH || join(__dirname, 'niches.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS searches (
    id TEXT PRIMARY KEY,
    keyword TEXT NOT NULL,
    marketplace TEXT DEFAULT 'uk',
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    results_json TEXT
  );

  CREATE TABLE IF NOT EXISTS saved_niches (
    id TEXT PRIMARY KEY,
    search_id TEXT,
    keyword TEXT NOT NULL,
    search_volume INTEGER,
    competitor_count INTEGER,
    avg_price REAL,
    avg_reviews REAL,
    max_reviews INTEGER,
    avg_monthly_revenue REAL,
    estimated_margin REAL,
    seasonality_months INTEGER,
    niche_score REAL,
    passes_criteria INTEGER DEFAULT 0,
    raw_data TEXT,
    saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (search_id) REFERENCES searches(id)
  );

  CREATE TABLE IF NOT EXISTS criteria (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    min_search_volume INTEGER DEFAULT 3000,
    max_competitors INTEGER DEFAULT 35,
    max_reviews INTEGER DEFAULT 1500,
    min_price REAL DEFAULT 6.99,
    max_price REAL DEFAULT 39.99,
    min_monthly_revenue REAL DEFAULT 2500,
    target_margin REAL DEFAULT 25,
    min_season_months INTEGER DEFAULT 6
  );

  INSERT OR IGNORE INTO criteria (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS api_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provider TEXT DEFAULT 'rainforest',
    api_key TEXT DEFAULT ''
  );

  INSERT OR IGNORE INTO api_settings (id) VALUES (1);
`);

// --- Middleware ---
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// --- API Provider ---
function getApiSettings() {
  return db.prepare('SELECT * FROM api_settings WHERE id = 1').get();
}

function getProvider() {
  const settings = getApiSettings();
  const provider = settings?.provider || process.env.API_PROVIDER || 'rainforest';
  const apiKey = settings?.api_key || '';

  if (provider === 'keepa') {
    return new KeepaProvider(apiKey || process.env.KEEPA_API_KEY);
  }
  return new RainforestProvider(apiKey || process.env.RAINFOREST_API_KEY);
}

// --- Analyzer ---
function getCriteria() {
  return db.prepare('SELECT * FROM criteria WHERE id = 1').get();
}

const analyzer = new NicheAnalyzer();

// --- API Routes ---

// Get API settings (key is masked)
app.get('/api/settings', (req, res) => {
  const settings = getApiSettings();
  res.json({
    provider: settings?.provider || 'rainforest',
    hasKey: !!(settings?.api_key),
    maskedKey: settings?.api_key
      ? settings.api_key.slice(0, 4) + '****' + settings.api_key.slice(-4)
      : '',
  });
});

// Update API settings
app.put('/api/settings', (req, res) => {
  const { provider, api_key } = req.body;

  if (provider && !['rainforest', 'keepa'].includes(provider)) {
    return res.status(400).json({ error: 'Provider must be "rainforest" or "keepa"' });
  }

  db.prepare(`
    UPDATE api_settings SET
      provider = COALESCE(?, provider),
      api_key = COALESCE(?, api_key)
    WHERE id = 1
  `).run(provider || null, api_key || null);

  const updated = getApiSettings();
  res.json({
    provider: updated.provider,
    hasKey: !!updated.api_key,
    maskedKey: updated.api_key
      ? updated.api_key.slice(0, 4) + '****' + updated.api_key.slice(-4)
      : '',
  });
});

// Get current criteria
app.get('/api/criteria', (req, res) => {
  const criteria = getCriteria();
  res.json(criteria);
});

// Update criteria
app.put('/api/criteria', (req, res) => {
  const {
    min_search_volume, max_competitors, max_reviews,
    min_price, max_price, min_monthly_revenue,
    target_margin, min_season_months
  } = req.body;

  db.prepare(`
    UPDATE criteria SET
      min_search_volume = COALESCE(?, min_search_volume),
      max_competitors = COALESCE(?, max_competitors),
      max_reviews = COALESCE(?, max_reviews),
      min_price = COALESCE(?, min_price),
      max_price = COALESCE(?, max_price),
      min_monthly_revenue = COALESCE(?, min_monthly_revenue),
      target_margin = COALESCE(?, target_margin),
      min_season_months = COALESCE(?, min_season_months)
    WHERE id = 1
  `).run(
    min_search_volume, max_competitors, max_reviews,
    min_price, max_price, min_monthly_revenue,
    target_margin, min_season_months
  );

  res.json(getCriteria());
});

// Search for a niche keyword
app.post('/api/search', async (req, res) => {
  const { keyword } = req.body;
  if (!keyword || keyword.trim().length === 0) {
    return res.status(400).json({ error: 'Keyword is required' });
  }

  const searchId = uuidv4();
  const marketplace = process.env.MARKETPLACE || 'uk';

  db.prepare(`
    INSERT INTO searches (id, keyword, marketplace, status)
    VALUES (?, ?, ?, 'processing')
  `).run(searchId, keyword.trim(), marketplace);

  res.json({ searchId, status: 'processing' });

  // Process in background
  try {
    const provider = getProvider();
    const rawData = await provider.searchNiche(keyword.trim(), marketplace);
    const criteria = getCriteria();
    const analysis = analyzer.analyze(rawData, criteria);

    const nicheId = uuidv4();
    db.prepare(`
      INSERT INTO saved_niches (
        id, search_id, keyword, search_volume, competitor_count,
        avg_price, avg_reviews, max_reviews, avg_monthly_revenue,
        estimated_margin, seasonality_months, niche_score, passes_criteria, raw_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nicheId, searchId, keyword.trim(),
      analysis.searchVolume, analysis.competitorCount,
      analysis.avgPrice, analysis.avgReviews, analysis.maxReviews,
      analysis.avgMonthlyRevenue, analysis.estimatedMargin,
      analysis.seasonalityMonths, analysis.nicheScore,
      analysis.passesCriteria ? 1 : 0,
      JSON.stringify(rawData)
    );

    db.prepare(`
      UPDATE searches SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
      results_json = ? WHERE id = ?
    `).run(JSON.stringify(analysis), searchId);

  } catch (err) {
    console.error('Search failed:', err.message);
    db.prepare(`
      UPDATE searches SET status = 'failed', results_json = ? WHERE id = ?
    `).run(JSON.stringify({ error: err.message }), searchId);
  }
});

// Bulk search - multiple keywords
app.post('/api/search/bulk', async (req, res) => {
  const { keywords } = req.body;
  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
    return res.status(400).json({ error: 'Keywords array is required' });
  }

  const searchIds = keywords.map(kw => {
    const searchId = uuidv4();
    const marketplace = process.env.MARKETPLACE || 'uk';
    db.prepare(`
      INSERT INTO searches (id, keyword, marketplace, status)
      VALUES (?, ?, ?, 'pending')
    `).run(searchId, kw.trim(), marketplace);
    return { searchId, keyword: kw.trim() };
  });

  res.json({ searches: searchIds, status: 'queued' });

  // Process sequentially to avoid rate limits
  for (const { searchId, keyword } of searchIds) {
    try {
      db.prepare('UPDATE searches SET status = ? WHERE id = ?').run('processing', searchId);
      const provider = getProvider();
      const rawData = await provider.searchNiche(keyword, process.env.MARKETPLACE || 'uk');
      const criteria = getCriteria();
      const analysis = analyzer.analyze(rawData, criteria);

      const nicheId = uuidv4();
      db.prepare(`
        INSERT INTO saved_niches (
          id, search_id, keyword, search_volume, competitor_count,
          avg_price, avg_reviews, max_reviews, avg_monthly_revenue,
          estimated_margin, seasonality_months, niche_score, passes_criteria, raw_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        nicheId, searchId, keyword,
        analysis.searchVolume, analysis.competitorCount,
        analysis.avgPrice, analysis.avgReviews, analysis.maxReviews,
        analysis.avgMonthlyRevenue, analysis.estimatedMargin,
        analysis.seasonalityMonths, analysis.nicheScore,
        analysis.passesCriteria ? 1 : 0,
        JSON.stringify(rawData)
      );

      db.prepare(`
        UPDATE searches SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
        results_json = ? WHERE id = ?
      `).run(JSON.stringify(analysis), searchId);

    } catch (err) {
      console.error(`Search failed for "${keyword}":`, err.message);
      db.prepare(`
        UPDATE searches SET status = 'failed', results_json = ? WHERE id = ?
      `).run(JSON.stringify({ error: err.message }), searchId);
    }
  }
});

// Get search status
app.get('/api/search/:id', (req, res) => {
  const search = db.prepare('SELECT * FROM searches WHERE id = ?').get(req.params.id);
  if (!search) return res.status(404).json({ error: 'Search not found' });

  const niche = db.prepare('SELECT * FROM saved_niches WHERE search_id = ?').get(search.id);
  res.json({
    ...search,
    results_json: search.results_json ? JSON.parse(search.results_json) : null,
    niche
  });
});

// Get all searches
app.get('/api/searches', (req, res) => {
  const searches = db.prepare(`
    SELECT s.*, n.niche_score, n.passes_criteria, n.search_volume,
           n.competitor_count, n.avg_price, n.max_reviews, n.avg_monthly_revenue,
           n.estimated_margin, n.seasonality_months
    FROM searches s
    LEFT JOIN saved_niches n ON n.search_id = s.id
    ORDER BY s.created_at DESC
    LIMIT 100
  `).all();
  res.json(searches);
});

// Get saved niches that pass criteria
app.get('/api/niches/passing', (req, res) => {
  const niches = db.prepare(`
    SELECT * FROM saved_niches
    WHERE passes_criteria = 1
    ORDER BY niche_score DESC
  `).all();
  res.json(niches);
});

// Get all saved niches
app.get('/api/niches', (req, res) => {
  const sort = req.query.sort || 'niche_score';
  const allowedSorts = ['niche_score', 'search_volume', 'avg_monthly_revenue', 'estimated_margin', 'saved_at'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'niche_score';

  const niches = db.prepare(`
    SELECT * FROM saved_niches
    ORDER BY ${sortCol} DESC
    LIMIT 200
  `).all();
  res.json(niches);
});

// Delete a saved niche
app.delete('/api/niches/:id', (req, res) => {
  db.prepare('DELETE FROM saved_niches WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Dashboard stats
app.get('/api/stats', (req, res) => {
  const totalSearches = db.prepare('SELECT COUNT(*) as count FROM searches').get().count;
  const completedSearches = db.prepare("SELECT COUNT(*) as count FROM searches WHERE status = 'completed'").get().count;
  const passingNiches = db.prepare('SELECT COUNT(*) as count FROM saved_niches WHERE passes_criteria = 1').get().count;
  const totalNiches = db.prepare('SELECT COUNT(*) as count FROM saved_niches').get().count;
  const topNiche = db.prepare('SELECT * FROM saved_niches ORDER BY niche_score DESC LIMIT 1').get();

  res.json({
    totalSearches,
    completedSearches,
    passingNiches,
    totalNiches,
    topNiche
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback
app.get('/{*splat}', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Amazon Niche Finder running on port ${PORT}`);
  console.log(`API Provider: ${process.env.API_PROVIDER || 'rainforest'}`);
});
