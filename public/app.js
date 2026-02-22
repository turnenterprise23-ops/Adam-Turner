// === State ===
let currentUser = null;
let countdownInterval = null;

// === API Helper ===
async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// === Auth ===
async function checkAuth() {
  try {
    const data = await api('/api/auth/me');
    currentUser = data.user;
    showApp();
  } catch {
    showAuthScreen();
  }
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('dashboard-screen').classList.add('hidden');
  document.getElementById('leaderboard-screen').classList.add('hidden');
  document.getElementById('admin-screen').classList.add('hidden');
  document.getElementById('header').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('header').classList.remove('hidden');
  document.getElementById('user-name').textContent = currentUser.name;

  // Build nav
  const nav = document.getElementById('nav-links');
  nav.innerHTML = `
    <button class="active" onclick="navigate('dashboard')">Dashboard</button>
    <button onclick="navigate('leaderboard')">Leaderboard</button>
    ${currentUser.is_admin ? '<button onclick="navigate(\'admin\')">Admin</button>' : ''}
  `;

  navigate('dashboard');
}

function navigate(screen) {
  // Hide all screens
  document.getElementById('dashboard-screen').classList.add('hidden');
  document.getElementById('leaderboard-screen').classList.add('hidden');
  document.getElementById('admin-screen').classList.add('hidden');

  // Update nav active state
  document.querySelectorAll('#nav-links button').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.toLowerCase().includes(screen));
  });

  // Show requested screen
  document.getElementById(`${screen}-screen`).classList.remove('hidden');

  // Load screen data
  if (screen === 'dashboard') loadDashboard();
  else if (screen === 'leaderboard') loadLeaderboard();
  else if (screen === 'admin') loadAdmin();
}

function showAuthTab(tab) {
  document.querySelectorAll('.auth-tabs .tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
}

async function handleLogin(e) {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: {
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value,
      },
    });
    currentUser = data.user;
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const errEl = document.getElementById('register-error');
  errEl.classList.add('hidden');
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: {
        name: document.getElementById('reg-name').value,
        email: document.getElementById('reg-email').value,
        password: document.getElementById('reg-password').value,
      },
    });
    currentUser = data.user;
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  if (countdownInterval) clearInterval(countdownInterval);
  showAuthScreen();
}

// === Dashboard ===
async function loadDashboard() {
  await Promise.all([loadActiveGameweek(), loadMyPicks()]);
}

async function loadActiveGameweek() {
  const gwContent = document.getElementById('active-gw-content');
  const gwStatus = document.getElementById('gw-status');
  const pickContent = document.getElementById('pick-content');

  try {
    const { gameweek } = await api('/api/gameweeks/active');

    if (!gameweek) {
      gwStatus.textContent = 'No Active Week';
      gwStatus.className = 'badge badge-complete';
      gwContent.innerHTML = '<div class="card-body"><p class="text-muted text-center">No gameweek is currently active. Check back soon.</p></div>';
      pickContent.innerHTML = '<div class="card-body"><p class="text-muted text-center">Waiting for the next gameweek to open.</p></div>';
      return;
    }

    gwStatus.textContent = `GW ${gameweek.week_number}`;
    gwStatus.className = 'badge badge-active';

    const deadline = new Date(gameweek.computed_deadline);
    const kickoff = new Date(gameweek.first_kickoff);

    gwContent.innerHTML = `
      <div class="card-body">
        <p><strong>${gameweek.label}</strong></p>
        <p class="text-muted">First Kickoff: ${kickoff.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} at ${kickoff.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
        <p class="text-muted">Deadline: ${deadline.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} at ${deadline.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
        <div id="countdown" class="countdown mt-2"></div>
      </div>
    `;

    startCountdown(deadline);
    await loadAvailableTeams();
  } catch (err) {
    gwContent.innerHTML = `<div class="card-body"><p class="error-msg">${err.message}</p></div>`;
  }
}

function startCountdown(deadline) {
  if (countdownInterval) clearInterval(countdownInterval);

  function update() {
    const now = new Date();
    const diff = deadline - now;
    const el = document.getElementById('countdown');
    if (!el) return;

    if (diff <= 0) {
      el.innerHTML = '<span class="countdown-label">Deadline</span><br>LOCKED';
      el.className = 'countdown urgent';
      clearInterval(countdownInterval);
      return;
    }

    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);

    let timeStr = '';
    if (days > 0) timeStr += `${days}d `;
    timeStr += `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    el.innerHTML = `<span class="countdown-label">Time Remaining</span><br>${timeStr}`;
    el.className = diff < 3600000 ? 'countdown urgent' : 'countdown';
  }

  update();
  countdownInterval = setInterval(update, 1000);
}

async function loadAvailableTeams() {
  const pickContent = document.getElementById('pick-content');

  try {
    const data = await api('/api/picks/available-teams');

    if (data.currentPick) {
      pickContent.innerHTML = `
        <div class="pick-confirmed card-body">
          <span class="lock-icon">&#128274;</span>
          <p class="team-name">${data.currentPick}</p>
          <p class="text-muted">Your pick is locked in for this week</p>
        </div>
      `;
      return;
    }

    if (data.locked) {
      pickContent.innerHTML = `
        <div class="card-body text-center">
          <p class="text-muted">${data.message || 'Picks are locked for this gameweek.'}</p>
        </div>
      `;
      return;
    }

    if (currentUser.is_eliminated) {
      pickContent.innerHTML = `
        <div class="card-body text-center">
          <span class="badge badge-eliminated">Eliminated</span>
          <p class="text-muted mt-1">You have been eliminated from the competition.</p>
        </div>
      `;
      return;
    }

    if (data.teams.length === 0) {
      pickContent.innerHTML = '<div class="card-body"><p class="text-muted text-center">No teams available.</p></div>';
      return;
    }

    let html = '<div class="team-grid">';
    data.teams.forEach(team => {
      html += `<button class="team-btn" onclick="selectTeam(this, '${team}')">${team}</button>`;
    });
    html += '</div>';
    html += '<div class="card-body text-center"><button id="confirm-pick-btn" class="btn btn-primary" onclick="confirmPick()" disabled>Confirm Pick</button><p class="help-text mt-1">Once confirmed, your pick cannot be changed.</p></div>';

    pickContent.innerHTML = html;
  } catch (err) {
    pickContent.innerHTML = `<div class="card-body"><p class="error-msg">${err.message}</p></div>`;
  }
}

let selectedTeam = null;

function selectTeam(el, team) {
  if (el.classList.contains('used')) return;
  document.querySelectorAll('.team-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  selectedTeam = team;
  document.getElementById('confirm-pick-btn').disabled = false;
}

async function confirmPick() {
  if (!selectedTeam) return;

  if (!confirm(`Are you sure you want to pick ${selectedTeam}? This cannot be changed.`)) return;

  const btn = document.getElementById('confirm-pick-btn');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    await api('/api/picks/submit', { method: 'POST', body: { team: selectedTeam } });
    selectedTeam = null;
    await loadDashboard();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    btn.textContent = 'Confirm Pick';
  }
}

async function loadMyPicks() {
  const container = document.getElementById('my-picks-content');
  try {
    const { picks } = await api('/api/picks/my');

    if (picks.length === 0) {
      container.innerHTML = '<div class="card-body"><p class="text-muted text-center">No picks yet.</p></div>';
      return;
    }

    let html = '<div class="table-wrap"><table><thead><tr><th>Week</th><th>Team</th><th>Type</th><th>Date</th></tr></thead><tbody>';
    picks.forEach(p => {
      const date = new Date(p.picked_at).toLocaleDateString('en-GB');
      html += `<tr>
        <td>${p.label}</td>
        <td><strong>${p.team}</strong></td>
        <td>${p.is_auto_assigned ? '<span class="badge badge-auto">Auto</span>' : '<span class="badge badge-locked">Picked</span>'}</td>
        <td>${date}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="card-body"><p class="error-msg">${err.message}</p></div>`;
  }
}

// === Leaderboard ===
async function loadLeaderboard() {
  const container = document.getElementById('leaderboard-content');
  try {
    const { standings } = await api('/api/leaderboard');

    if (standings.length === 0) {
      container.innerHTML = '<div class="card-body"><p class="text-muted text-center">No entries yet.</p></div>';
      return;
    }

    let html = '<div class="table-wrap"><table><thead><tr><th>#</th><th>Name</th><th>Weeks Survived</th><th>Status</th></tr></thead><tbody>';
    standings.forEach((s, i) => {
      const status = s.is_eliminated
        ? '<span class="badge badge-eliminated">Eliminated</span>'
        : '<span class="badge badge-alive">In</span>';
      html += `<tr>
        <td>${i + 1}</td>
        <td>${s.name}</td>
        <td>${s.weeks_survived}</td>
        <td>${status}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="card-body"><p class="error-msg">${err.message}</p></div>`;
  }
}

// === Admin ===
function showAdminTab(tab) {
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(`admin-${tab}`).classList.remove('hidden');
  document.querySelectorAll('#admin-tabs .tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');

  if (tab === 'gameweeks') loadAdminGameweeks();
  else if (tab === 'users') loadAdminUsers();
  else if (tab === 'picks') loadAdminPicksSetup();
  else if (tab === 'results') loadAdminResultsSetup();
}

async function loadAdmin() {
  await loadAdminGameweeks();
}

async function loadAdminGameweeks() {
  const container = document.getElementById('admin-gw-list');
  try {
    const { gameweeks } = await api('/api/gameweeks');

    if (gameweeks.length === 0) {
      container.innerHTML = '<div class="card-body"><p class="text-muted text-center">No gameweeks created yet.</p></div>';
      return;
    }

    let html = '<div class="table-wrap"><table><thead><tr><th>Week</th><th>Label</th><th>First Kickoff</th><th>Deadline</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    gameweeks.forEach(gw => {
      const kickoff = new Date(gw.first_kickoff);
      const deadline = new Date(gw.deadline);
      let status = '';
      if (gw.is_complete) status = '<span class="badge badge-complete">Complete</span>';
      else if (gw.is_active) status = '<span class="badge badge-active">Active</span>';
      else status = '<span class="badge">Upcoming</span>';

      html += `<tr>
        <td>${gw.week_number}</td>
        <td>${gw.label}</td>
        <td>${kickoff.toLocaleDateString('en-GB')} ${kickoff.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
        <td>${deadline.toLocaleDateString('en-GB')} ${deadline.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
        <td>${status}</td>
        <td>
          ${!gw.is_active && !gw.is_complete ? `<button class="btn btn-sm btn-primary" onclick="activateGW(${gw.id})">Activate</button>` : ''}
          ${gw.is_active ? `<button class="btn btn-sm btn-success" onclick="autoAssignGW(${gw.id})">Auto-Assign</button> <button class="btn btn-sm btn-danger" onclick="completeGW(${gw.id})">Complete</button>` : ''}
        </td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="card-body"><p class="error-msg">${err.message}</p></div>`;
  }
}

async function addGameweek(e) {
  e.preventDefault();
  try {
    await api('/api/admin/gameweeks', {
      method: 'POST',
      body: {
        week_number: parseInt(document.getElementById('gw-number').value),
        label: document.getElementById('gw-label').value,
        first_kickoff: new Date(document.getElementById('gw-kickoff').value).toISOString(),
      },
    });
    document.getElementById('gw-number').value = '';
    document.getElementById('gw-label').value = '';
    document.getElementById('gw-kickoff').value = '';
    await loadAdminGameweeks();
  } catch (err) {
    alert(err.message);
  }
}

async function activateGW(id) {
  if (!confirm('Activate this gameweek? This will deactivate any currently active gameweek.')) return;
  try {
    await api(`/api/admin/gameweeks/${id}/activate`, { method: 'POST' });
    await loadAdminGameweeks();
  } catch (err) { alert(err.message); }
}

async function autoAssignGW(id) {
  if (!confirm('Auto-assign teams to all users who have not submitted a pick? They will get the next available team alphabetically.')) return;
  try {
    const data = await api(`/api/admin/gameweeks/${id}/auto-assign`, { method: 'POST' });
    alert(`Auto-assigned ${data.assigned} picks out of ${data.total_missing} missing.`);
    await loadAdminGameweeks();
  } catch (err) { alert(err.message); }
}

async function completeGW(id) {
  if (!confirm('Mark this gameweek as complete? Make sure results are entered first.')) return;
  try {
    await api(`/api/admin/gameweeks/${id}/complete`, { method: 'POST' });
    await loadAdminGameweeks();
  } catch (err) { alert(err.message); }
}

// Admin Users
async function loadAdminUsers() {
  const container = document.getElementById('admin-users-list');
  try {
    const { users } = await api('/api/admin/users');

    let paid = 0, total = 0;
    users.forEach(u => { if (!u.is_admin) { total++; if (u.paid) paid++; } });

    let html = `<div class="card-body"><p class="text-muted">Total entries: <strong>${total}</strong> | Paid: <strong>${paid}</strong> | Outstanding: <strong>${total - paid}</strong> | Pool: <strong>&pound;${paid * 10}</strong></p></div>`;
    html += '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Paid</th><th>Actions</th></tr></thead><tbody>';

    users.filter(u => !u.is_admin).forEach(u => {
      const status = u.is_eliminated
        ? '<span class="badge badge-eliminated">Eliminated</span>'
        : '<span class="badge badge-alive">Active</span>';
      const paidBadge = u.paid
        ? '<span class="badge badge-paid">Paid</span>'
        : '<span class="badge badge-unpaid">Unpaid</span>';

      html += `<tr>
        <td>${u.name}</td>
        <td>${u.email}</td>
        <td>${status}</td>
        <td>${paidBadge}</td>
        <td>
          ${!u.paid ? `<button class="btn btn-sm btn-success" onclick="markPaid('${u.id}')">Mark Paid</button>` : ''}
          ${!u.is_eliminated ? `<button class="btn btn-sm btn-danger" onclick="eliminateUser('${u.id}')">Eliminate</button>` : `<button class="btn btn-sm btn-primary" onclick="reinstateUser('${u.id}')">Reinstate</button>`}
          <button class="btn btn-sm btn-danger" onclick="deleteUser('${u.id}', '${u.name}')">Delete</button>
        </td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="card-body"><p class="error-msg">${err.message}</p></div>`;
  }
}

async function markPaid(id) {
  try { await api(`/api/admin/users/${id}/paid`, { method: 'POST' }); await loadAdminUsers(); }
  catch (err) { alert(err.message); }
}

async function eliminateUser(id) {
  if (!confirm('Eliminate this user?')) return;
  try { await api(`/api/admin/users/${id}/eliminate`, { method: 'POST' }); await loadAdminUsers(); }
  catch (err) { alert(err.message); }
}

async function reinstateUser(id) {
  if (!confirm('Reinstate this user?')) return;
  try { await api(`/api/admin/users/${id}/reinstate`, { method: 'POST' }); await loadAdminUsers(); }
  catch (err) { alert(err.message); }
}

async function deleteUser(id, name) {
  if (!confirm(`Permanently delete ${name}? This will also delete all their picks.`)) return;
  try { await api(`/api/admin/users/${id}`, { method: 'DELETE' }); await loadAdminUsers(); }
  catch (err) { alert(err.message); }
}

// Admin Picks
async function loadAdminPicksSetup() {
  const select = document.getElementById('admin-pick-gw');
  try {
    const { gameweeks } = await api('/api/gameweeks');
    select.innerHTML = '<option value="">-- Select Gameweek --</option>';
    gameweeks.forEach(gw => {
      select.innerHTML += `<option value="${gw.id}">${gw.label}</option>`;
    });
  } catch (err) { console.error(err); }
}

async function loadAdminPicks() {
  const gwId = document.getElementById('admin-pick-gw').value;
  const container = document.getElementById('admin-picks-list');
  if (!gwId) { container.innerHTML = ''; return; }

  try {
    const { picks } = await api(`/api/admin/picks/${gwId}`);

    if (picks.length === 0) {
      container.innerHTML = '<p class="text-muted text-center mt-2">No picks for this gameweek.</p>';
      return;
    }

    let html = '<div class="table-wrap mt-2"><table><thead><tr><th>Name</th><th>Email</th><th>Pick</th><th>Type</th><th>Status</th></tr></thead><tbody>';
    picks.forEach(p => {
      const type = p.is_auto_assigned ? '<span class="badge badge-auto">Auto</span>' : '<span class="badge badge-locked">Manual</span>';
      const status = p.is_eliminated
        ? '<span class="badge badge-eliminated">Eliminated</span>'
        : '<span class="badge badge-alive">Active</span>';
      html += `<tr>
        <td>${p.user_name}</td>
        <td>${p.user_email}</td>
        <td><strong>${p.team}</strong></td>
        <td>${type}</td>
        <td>${status}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<p class="error-msg">${err.message}</p>`;
  }
}

// Admin Results
async function loadAdminResultsSetup() {
  const select = document.getElementById('admin-result-gw');
  const teamsContainer = document.getElementById('admin-results-teams');
  try {
    const { gameweeks } = await api('/api/gameweeks');
    const { teams } = await api('/api/teams');

    select.innerHTML = '<option value="">-- Select Gameweek --</option>';
    gameweeks.forEach(gw => {
      select.innerHTML += `<option value="${gw.id}">${gw.label}</option>`;
    });

    teamsContainer.innerHTML = '';
    teams.forEach(team => {
      teamsContainer.innerHTML += `<button class="team-btn" onclick="toggleResultTeam(this, '${team}')">${team}</button>`;
    });
  } catch (err) { console.error(err); }
}

function toggleResultTeam(el) {
  el.classList.toggle('selected');
}

async function submitResults() {
  const gwId = document.getElementById('admin-result-gw').value;
  if (!gwId) { alert('Please select a gameweek'); return; }

  const winningTeams = [];
  document.querySelectorAll('#admin-results-teams .team-btn.selected').forEach(btn => {
    winningTeams.push(btn.textContent);
  });

  if (winningTeams.length === 0) {
    if (!confirm('No winning teams selected. All picks will be marked as losses. Continue?')) return;
  }

  if (!confirm(`Submit results? Winners: ${winningTeams.join(', ') || 'None'}. Users who picked losing teams will be eliminated.`)) return;

  try {
    const data = await api('/api/admin/results', {
      method: 'POST',
      body: { gameweek_id: parseInt(gwId), winning_teams: winningTeams },
    });
    const feedback = document.getElementById('results-feedback');
    feedback.className = 'success-msg mt-2';
    feedback.textContent = `Results saved. ${data.eliminated} user(s) eliminated.`;
  } catch (err) { alert(err.message); }
}

// === Init ===
checkAuth();
