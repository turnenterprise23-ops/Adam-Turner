const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// --- Database Setup ---
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'lastmanstanding.db');
// Ensure the directory for the database file exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    is_eliminated INTEGER DEFAULT 0,
    paid INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gameweeks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_number INTEGER UNIQUE NOT NULL,
    label TEXT NOT NULL,
    deadline TEXT NOT NULL,
    first_kickoff TEXT NOT NULL,
    is_active INTEGER DEFAULT 0,
    is_complete INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS picks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    gameweek_id INTEGER NOT NULL,
    team TEXT NOT NULL,
    is_auto_assigned INTEGER DEFAULT 0,
    locked INTEGER DEFAULT 1,
    picked_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (gameweek_id) REFERENCES gameweeks(id),
    UNIQUE(user_id, gameweek_id),
    UNIQUE(user_id, team)
  );

  CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gameweek_id INTEGER NOT NULL,
    team TEXT NOT NULL,
    won INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (gameweek_id) REFERENCES gameweeks(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Insert default settings if not present
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
insertSetting.run('entry_fee', '10');
insertSetting.run('prize_pool', '2000');
insertSetting.run('winner_prize', '1200');
insertSetting.run('club_share', '800');
insertSetting.run('deadline_minutes_before', '90');

// Create default admin if none exists
const adminExists = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 1').get();
if (adminExists.count === 0) {
  const adminId = uuidv4();
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@lastmanstanding.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const hashedPw = bcrypt.hashSync(adminPassword, 10);
  db.prepare('INSERT INTO users (id, name, email, password, is_admin, paid) VALUES (?, ?, ?, ?, 1, 1)')
    .run(adminId, 'Admin', adminEmail, hashedPw);
  if (!IS_PROD) {
    console.log(`Default admin created: ${adminEmail} / ${adminPassword}`);
  }
}

// Premier League teams
const TEAMS = [
  'Arsenal', 'Aston Villa', 'Bournemouth', 'Brentford', 'Brighton',
  'Chelsea', 'Crystal Palace', 'Everton', 'Fulham', 'Ipswich Town',
  'Leicester City', 'Liverpool', 'Manchester City', 'Manchester United',
  'Newcastle United', 'Nottingham Forest', 'Southampton', 'Tottenham Hotspur',
  'West Ham United', 'Wolverhampton Wanderers'
];

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

const sessionSecret = process.env.SESSION_SECRET || 'lms-secret-change-in-production-' + uuidv4();
if (IS_PROD && !process.env.SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET not set. Sessions will not persist across restarts.');
}

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    secure: IS_PROD,
    httpOnly: true,
    sameSite: 'lax'
  },
  proxy: IS_PROD
}));

if (IS_PROD) {
  app.set('trust proxy', 1);
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// --- Auth Routes ---
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) {
    return res.status(400).json({ error: 'Email already registered' });
  }
  const id = uuidv4();
  const hashed = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)')
    .run(id, name.trim(), email.toLowerCase().trim(), hashed);
  req.session.userId = id;
  res.json({ success: true, user: { id, name: name.trim(), email: email.toLowerCase().trim(), is_admin: 0 } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email?.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  req.session.userId = user.id;
  res.json({
    success: true,
    user: { id: user.id, name: user.name, email: user.email, is_admin: user.is_admin }
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, is_admin, is_eliminated, paid FROM users WHERE id = ?')
    .get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// --- Teams ---
app.get('/api/teams', requireAuth, (req, res) => {
  res.json({ teams: TEAMS });
});

// --- Gameweeks ---
app.get('/api/gameweeks', requireAuth, (req, res) => {
  const gameweeks = db.prepare('SELECT * FROM gameweeks ORDER BY week_number ASC').all();
  res.json({ gameweeks });
});

app.get('/api/gameweeks/active', requireAuth, (req, res) => {
  const gw = db.prepare('SELECT * FROM gameweeks WHERE is_active = 1').get();
  if (!gw) return res.json({ gameweek: null });

  const deadlineMinutes = db.prepare("SELECT value FROM settings WHERE key = 'deadline_minutes_before'").get();
  const minutesBefore = parseInt(deadlineMinutes?.value || '90', 10);

  const kickoff = new Date(gw.first_kickoff);
  const deadline = new Date(kickoff.getTime() - minutesBefore * 60 * 1000);

  res.json({
    gameweek: { ...gw, computed_deadline: deadline.toISOString() }
  });
});

// --- Picks ---
app.get('/api/picks/my', requireAuth, (req, res) => {
  const picks = db.prepare(`
    SELECT p.*, g.week_number, g.label
    FROM picks p JOIN gameweeks g ON p.gameweek_id = g.id
    WHERE p.user_id = ?
    ORDER BY g.week_number ASC
  `).all(req.session.userId);
  res.json({ picks });
});

app.get('/api/picks/available-teams', requireAuth, (req, res) => {
  const gw = db.prepare('SELECT * FROM gameweeks WHERE is_active = 1').get();
  if (!gw) return res.json({ teams: [], deadline: null, locked: true });

  // Check deadline
  const deadlineMinutes = db.prepare("SELECT value FROM settings WHERE key = 'deadline_minutes_before'").get();
  const minutesBefore = parseInt(deadlineMinutes?.value || '90', 10);
  const kickoff = new Date(gw.first_kickoff);
  const deadline = new Date(kickoff.getTime() - minutesBefore * 60 * 1000);
  const now = new Date();

  if (now >= deadline) {
    return res.json({ teams: [], deadline: deadline.toISOString(), locked: true, message: 'Deadline has passed' });
  }

  // Get teams already picked by this user in previous weeks
  const usedTeams = db.prepare('SELECT team FROM picks WHERE user_id = ?')
    .all(req.session.userId)
    .map(r => r.team);

  // Check if user already picked for this gameweek
  const existingPick = db.prepare('SELECT * FROM picks WHERE user_id = ? AND gameweek_id = ?')
    .get(req.session.userId, gw.id);

  if (existingPick) {
    return res.json({
      teams: [], deadline: deadline.toISOString(), locked: true,
      message: 'You have already submitted your pick for this week',
      currentPick: existingPick.team
    });
  }

  const available = TEAMS.filter(t => !usedTeams.includes(t));
  res.json({ teams: available, deadline: deadline.toISOString(), locked: false });
});

app.post('/api/picks/submit', requireAuth, (req, res) => {
  const { team } = req.body;
  if (!team) return res.status(400).json({ error: 'Team is required' });
  if (!TEAMS.includes(team)) return res.status(400).json({ error: 'Invalid team' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (user.is_eliminated) return res.status(400).json({ error: 'You have been eliminated' });

  const gw = db.prepare('SELECT * FROM gameweeks WHERE is_active = 1').get();
  if (!gw) return res.status(400).json({ error: 'No active gameweek' });

  // Check deadline
  const deadlineMinutes = db.prepare("SELECT value FROM settings WHERE key = 'deadline_minutes_before'").get();
  const minutesBefore = parseInt(deadlineMinutes?.value || '90', 10);
  const kickoff = new Date(gw.first_kickoff);
  const deadline = new Date(kickoff.getTime() - minutesBefore * 60 * 1000);
  const now = new Date();

  if (now >= deadline) {
    return res.status(400).json({ error: 'Deadline has passed. Picks are locked.' });
  }

  // Check not already picked this week
  const existingPick = db.prepare('SELECT * FROM picks WHERE user_id = ? AND gameweek_id = ?')
    .get(req.session.userId, gw.id);
  if (existingPick) {
    return res.status(400).json({ error: 'You have already submitted a pick for this week. Picks cannot be changed.' });
  }

  // Check team not already used
  const usedTeam = db.prepare('SELECT * FROM picks WHERE user_id = ? AND team = ?')
    .get(req.session.userId, team);
  if (usedTeam) {
    return res.status(400).json({ error: `You have already used ${team} in a previous week` });
  }

  const pickId = uuidv4();
  db.prepare('INSERT INTO picks (id, user_id, gameweek_id, team, locked) VALUES (?, ?, ?, ?, 1)')
    .run(pickId, req.session.userId, gw.id, team);

  res.json({ success: true, pick: { id: pickId, team, gameweek_id: gw.id, locked: true } });
});

// --- Admin Routes ---
app.post('/api/admin/gameweeks', requireAdmin, (req, res) => {
  const { week_number, label, first_kickoff } = req.body;
  if (!week_number || !label || !first_kickoff) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const deadlineMinutes = db.prepare("SELECT value FROM settings WHERE key = 'deadline_minutes_before'").get();
  const minutesBefore = parseInt(deadlineMinutes?.value || '90', 10);
  const kickoff = new Date(first_kickoff);
  const deadline = new Date(kickoff.getTime() - minutesBefore * 60 * 1000);

  try {
    db.prepare('INSERT INTO gameweeks (week_number, label, first_kickoff, deadline) VALUES (?, ?, ?, ?)')
      .run(week_number, label, first_kickoff, deadline.toISOString());
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'Gameweek number already exists' });
  }
});

app.post('/api/admin/gameweeks/:id/activate', requireAdmin, (req, res) => {
  db.prepare('UPDATE gameweeks SET is_active = 0').run();
  db.prepare('UPDATE gameweeks SET is_active = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/gameweeks/:id/complete', requireAdmin, (req, res) => {
  db.prepare('UPDATE gameweeks SET is_active = 0, is_complete = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/gameweeks/:id/auto-assign', requireAdmin, (req, res) => {
  const gw = db.prepare('SELECT * FROM gameweeks WHERE id = ?').get(req.params.id);
  if (!gw) return res.status(404).json({ error: 'Gameweek not found' });

  // Find all non-eliminated users who haven't picked
  const allUsers = db.prepare('SELECT * FROM users WHERE is_eliminated = 0 AND is_admin = 0').all();
  const usersWithPicks = db.prepare('SELECT user_id FROM picks WHERE gameweek_id = ?').all(gw.id).map(r => r.user_id);
  const usersWithout = allUsers.filter(u => !usersWithPicks.includes(u.id));

  let assigned = 0;
  for (const user of usersWithout) {
    const usedTeams = db.prepare('SELECT team FROM picks WHERE user_id = ?').all(user.id).map(r => r.team);
    const available = TEAMS.filter(t => !usedTeams.includes(t)).sort();

    if (available.length === 0) {
      // No teams left - eliminate
      db.prepare('UPDATE users SET is_eliminated = 1 WHERE id = ?').run(user.id);
      continue;
    }

    const autoTeam = available[0]; // First alphabetically
    const pickId = uuidv4();
    db.prepare('INSERT INTO picks (id, user_id, gameweek_id, team, is_auto_assigned, locked) VALUES (?, ?, ?, ?, 1, 1)')
      .run(pickId, user.id, gw.id, autoTeam);
    assigned++;
  }

  res.json({ success: true, assigned, total_missing: usersWithout.length });
});

app.post('/api/admin/results', requireAdmin, (req, res) => {
  const { gameweek_id, winning_teams } = req.body;
  if (!gameweek_id || !winning_teams || !Array.isArray(winning_teams)) {
    return res.status(400).json({ error: 'gameweek_id and winning_teams array required' });
  }

  const insertResult = db.prepare('INSERT OR REPLACE INTO results (gameweek_id, team, won) VALUES (?, ?, ?)');
  const insertMany = db.transaction((teams) => {
    // Mark all teams for this gameweek
    for (const team of TEAMS) {
      insertResult.run(gameweek_id, team, teams.includes(team) ? 1 : 0);
    }
  });
  insertMany(winning_teams);

  // Eliminate users whose pick didn't win
  const picks = db.prepare('SELECT * FROM picks WHERE gameweek_id = ?').all(gameweek_id);
  let eliminated = 0;
  for (const pick of picks) {
    if (!winning_teams.includes(pick.team)) {
      db.prepare('UPDATE users SET is_eliminated = 1 WHERE id = ?').run(pick.user_id);
      eliminated++;
    }
  }

  res.json({ success: true, eliminated });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, name, email, is_admin, is_eliminated, paid, created_at FROM users ORDER BY name ASC').all();
  res.json({ users });
});

app.post('/api/admin/users/:id/paid', requireAdmin, (req, res) => {
  db.prepare('UPDATE users SET paid = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/users/:id/eliminate', requireAdmin, (req, res) => {
  db.prepare('UPDATE users SET is_eliminated = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/users/:id/reinstate', requireAdmin, (req, res) => {
  db.prepare('UPDATE users SET is_eliminated = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM picks WHERE user_id = ?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id = ? AND is_admin = 0').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/picks/:gameweek_id', requireAdmin, (req, res) => {
  const picks = db.prepare(`
    SELECT p.*, u.name as user_name, u.email as user_email, u.is_eliminated
    FROM picks p JOIN users u ON p.user_id = u.id
    WHERE p.gameweek_id = ?
    ORDER BY u.name ASC
  `).all(req.params.gameweek_id);
  res.json({ picks });
});

app.get('/api/admin/standings', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.is_eliminated, u.paid,
           COUNT(p.id) as total_picks
    FROM users u
    LEFT JOIN picks p ON u.id = p.user_id
    WHERE u.is_admin = 0
    GROUP BY u.id
    ORDER BY u.is_eliminated ASC, u.name ASC
  `).all();
  res.json({ standings: users });
});

// Public leaderboard (no auth needed, limited info)
app.get('/api/leaderboard', (req, res) => {
  const standings = db.prepare(`
    SELECT u.name, u.is_eliminated, COUNT(p.id) as weeks_survived
    FROM users u
    LEFT JOIN picks p ON u.id = p.user_id
    WHERE u.is_admin = 0
    GROUP BY u.id
    ORDER BY u.is_eliminated ASC, weeks_survived DESC, u.name ASC
  `).all();

  const settings = {};
  db.prepare('SELECT * FROM settings').all().forEach(s => { settings[s.key] = s.value; });

  res.json({ standings, settings });
});

app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const settings = {};
  db.prepare('SELECT * FROM settings').all().forEach(s => { settings[s.key] = s.value; });
  res.json({ settings });
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const { key, value } = req.body;
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  res.json({ success: true });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', uptime: process.uptime() });
  } catch (e) {
    res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }
});

// SPA fallback
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  db.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  db.close();
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Last Man Standing server running on port ${PORT}`);
  console.log(`Environment: ${IS_PROD ? 'production' : 'development'}`);
});
