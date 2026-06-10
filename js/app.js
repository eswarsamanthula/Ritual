// ============================================================
//  RITUAL — APP
//  Today view, streaks, heatmap, stats, habit CRUD.
// ============================================================

// ─── STATE ───────────────────────────────────────────────────
const state = {
  habits: [],
  todayLogs: {},   // habitId → value
  yearLogs: [],    // all logs for heatmap
  currentView: 'today',
  editingHabitId: null,
  selectedColor: HABIT_PALETTE[0],
  selectedIcon: '◎',
  selectedType: 'checkbox',
  logModalHabitId: null,
};

const TODAY = new Date().toISOString().slice(0, 10);

// ─── UTILS ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function showToast(msg, type = 'info') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 3200);
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

function dateStr(date) { return date.toISOString().slice(0, 10); }

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── STREAK CALCULATION ──────────────────────────────────────
function calcStreak(habitId) {
  // Count consecutive days ending today where log exists and value >= target
  const habit = state.habits.find(h => h.id === habitId);
  if (!habit) return 0;
  const logs = state.yearLogs
    .filter(l => l.habit_id === habitId)
    .reduce((m, l) => { m[l.date] = l.value; return m; }, {});

  let streak = 0;
  const d = new Date();
  // Allow today to not be logged yet (don't break streak)
  while (true) {
    const s = dateStr(d);
    if (s === todayStr() && !logs[s]) { d.setDate(d.getDate() - 1); continue; }
    const val = logs[s];
    if (!val || val < habit.target) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// ─── INIT ────────────────────────────────────────────────────
async function init() {
  applyTheme();
  const hasSupabase = initSupabase();

  if (!hasSupabase) {
    $('auth-not-configured')?.classList.remove('hidden');
    $('google-signin-btn').disabled = true;
    $('email-action-btn').disabled = true;
    showAuth();
  } else {
    let _appShown = false;
    onAuthChange(async (session) => {
      if (session) {
        if (!_appShown) { _appShown = true; await showApp(session.user); }
      } else {
        _appShown = false;
        showAuth();
      }
    });
    const session = await getSession();
    if (session && !_appShown) { _appShown = true; await showApp(session.user); }
    else if (!session) showAuth();
  }

  bindEvents();
}

// ─── AUTH SCREENS ────────────────────────────────────────────
function showAuth() {
  $('auth-screen').classList.add('active');
  $('app-screen').classList.remove('active');
}

async function showApp(user) {
  $('auth-screen').classList.remove('active');
  $('app-screen').classList.add('active');

  // Fresh user fetch (server-side, not from JWT) for cross-device consistency
  if (typeof getFreshUser === 'function') {
    const fresh = await getFreshUser();
    if (fresh) { user = fresh; currentUser = fresh; }
  }

  if (user) {
    const name = user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'You';
    $('user-name').textContent = name;
    const avatar = $('user-avatar');
    if (user.user_metadata?.avatar_url) {
      avatar.src = user.user_metadata.avatar_url;
      avatar.style.display = 'block';
    } else {
      avatar.style.display = 'none';
    }
  }

  await seedDefaultHabits();
  await loadAll();
  renderView();
  initNotifications();
  initInstallBanner();
  initOfflineDetection();

  // Live cross-device sync with 500ms debounce
  let _rtTimer;
  subscribeRealtime(async (table) => {
    clearTimeout(_rtTimer);
    _rtTimer = setTimeout(async () => {
      await loadAll();
      renderView();
    }, 500);
  });
}

async function loadAll() {
  [state.habits] = await Promise.all([getHabits()]);
  const todayLogs = await getTodayLogs(todayStr());
  state.todayLogs = {};
  todayLogs.forEach(l => { state.todayLogs[l.habit_id] = l.value; });

  // Year logs for heatmap + streaks (last 365 days)
  const from = new Date();
  from.setFullYear(from.getFullYear() - 1);
  state.yearLogs = await getLogsRange(dateStr(from), todayStr());
}

// ─── VIEW ROUTING ────────────────────────────────────────────
function switchView(view) {
  state.currentView = view;
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`view-${view}`)?.classList.add('active');
  $$('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-view="${view}"]`)?.classList.add('active');
  const titles = { today: 'Today', history: 'History', stats: 'Stats', habits: 'My Habits', settings: 'Settings' };
  $('view-title').textContent = titles[view] || view;
  renderView();
}

function renderView() {
  if (state.currentView === 'today') renderToday();
  else if (state.currentView === 'history') renderHistory();
  else if (state.currentView === 'stats') renderStats();
  else if (state.currentView === 'habits') renderHabitsList();
  else if (state.currentView === 'settings') renderSettings();
  updateSyncBadge();
}

// ─── TODAY VIEW ──────────────────────────────────────────────
function renderToday() {
  const total = state.habits.length;
  const done = state.habits.filter(h => isHabitComplete(h)).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // Score ring
  const ring = $('score-ring-fill');
  if (ring) {
    const circ = 2 * Math.PI * 30;
    ring.style.strokeDasharray = circ;
    ring.style.strokeDashoffset = circ * (1 - pct / 100);
  }
  $('score-pct') && ($('score-pct').textContent = pct + '%');
  $('score-label') && ($('score-label').textContent = scoreLabel(pct));
  $('score-sub') && ($('score-sub').textContent = `${done} of ${total} habits done`);

  // Group by time_of_day
  const groups = { morning: [], afternoon: [], evening: [], any: [] };
  state.habits.forEach(h => groups[h.time_of_day]?.push(h));

  const grid = $('habits-grid');
  if (!grid) return;

  if (total === 0) {
    grid.innerHTML = `<div class="empty-state">
      <span class="empty-icon">◎</span>
      <p>No habits yet.<br/>Add your first one to begin.</p>
      <button class="btn-primary" onclick="openHabitModal(null)">+ Add Habit</button>
    </div>`;
    return;
  }

  const groupOrder = ['morning', 'afternoon', 'evening', 'any'];
  const groupLabels = { morning: '☀ Morning', afternoon: '◑ Afternoon', evening: '◐ Evening', any: '◎ Anytime' };

  grid.innerHTML = groupOrder.map(g => {
    if (!groups[g] || groups[g].length === 0) return '';
    return `
      <div class="group-section">
        <div class="group-label">${groupLabels[g]}</div>
        <div class="habit-cards">
          ${groups[g].map(h => buildHabitCard(h)).join('')}
        </div>
      </div>`;
  }).join('');
}

function isHabitComplete(h) {
  const val = state.todayLogs[h.id] || 0;
  return h.type === 'checkbox' ? val >= 1 : val >= h.target;
}

function scoreLabel(pct) {
  if (pct === 0) return 'Start your day';
  if (pct < 30) return 'Getting started';
  if (pct < 60) return 'Building momentum';
  if (pct < 90) return 'Almost there';
  if (pct < 100) return 'So close!';
  return 'Perfect day ✦';
}

function buildHabitCard(h) {
  const val = state.todayLogs[h.id] || 0;
  const complete = isHabitComplete(h);
  const pct = h.type === 'checkbox' ? (complete ? 100 : 0) : Math.min(100, (val / h.target) * 100);
  const streak = calcStreak(h.id);
  const circ = 2 * Math.PI * 22;
  const offset = circ * (1 - pct / 100);

  let controls = '';
  if (h.type === 'checkbox') {
    controls = `<button class="habit-check ${complete ? 'done' : ''}" onclick="toggleCheckbox('${h.id}')" style="--hc:${h.color}">
      ${complete ? '✓' : ''}
    </button>`;
  } else if (h.type === 'count') {
    controls = `<div class="count-controls">
      <button class="count-btn" onclick="adjustCount('${h.id}', -1)">−</button>
      <span class="count-val">${val}<span class="count-unit">/${h.target}</span></span>
      <button class="count-btn plus" onclick="adjustCount('${h.id}', 1)" style="color:${h.color}">+</button>
    </div>`;
  } else {
    controls = `<button class="log-time-btn" onclick="openLogModal('${h.id}')" style="border-color:${h.color};color:${h.color}">
      ${val > 0 ? val + ' ' + h.unit : 'Log ' + h.unit}
    </button>`;
  }

  return `<div class="habit-card ${complete ? 'complete' : ''}" style="--hc:${h.color}">
    <div class="habit-card-left">
      <div class="habit-ring-wrap">
        <svg width="52" height="52" viewBox="0 0 52 52">
          <circle cx="26" cy="26" r="22" fill="none" stroke="var(--ring-track)" stroke-width="3"/>
          <circle cx="26" cy="26" r="22" fill="none" stroke="${h.color}" stroke-width="3"
            stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
            stroke-linecap="round" transform="rotate(-90 26 26)"
            style="transition:stroke-dashoffset .5s ease"/>
        </svg>
        <span class="habit-icon" style="color:${h.color}">${escHtml(h.icon)}</span>
      </div>
    </div>
    <div class="habit-card-body">
      <div class="habit-name">${escHtml(h.name)}</div>
      <div class="habit-meta">${streak > 0 ? `<span class="streak-chip" style="color:${h.color}">◉ ${streak}d</span>` : ''}
        ${h.type !== 'checkbox' ? `<span class="target-chip">${h.target} ${h.unit}</span>` : ''}
      </div>
      ${controls}
    </div>
  </div>`;
}

// ─── HABIT INTERACTIONS ──────────────────────────────────────
async function toggleCheckbox(habitId) {
  const current = state.todayLogs[habitId] || 0;
  const newVal = current >= 1 ? 0 : 1;
  if (newVal === 0) {
    await deleteLog(habitId, todayStr());
    delete state.todayLogs[habitId];
  } else {
    await upsertLog(habitId, todayStr(), newVal, null);
    state.todayLogs[habitId] = newVal;
  }
  renderToday();
  writeRitualSnapshot();
}

async function adjustCount(habitId, delta) {
  const habit = state.habits.find(h => h.id === habitId);
  if (!habit) return;
  const current = state.todayLogs[habitId] || 0;
  const next = Math.max(0, current + delta);
  if (next === 0) {
    await deleteLog(habitId, todayStr());
    delete state.todayLogs[habitId];
  } else {
    await upsertLog(habitId, todayStr(), next, null);
    state.todayLogs[habitId] = next;
  }
  renderToday();
  writeRitualSnapshot();
}

function openLogModal(habitId) {
  const habit = state.habits.find(h => h.id === habitId);
  if (!habit) return;
  state.logModalHabitId = habitId;
  $('log-modal-title').textContent = habit.name;
  $('log-modal-unit').textContent = habit.unit;
  $('log-time-input').value = state.todayLogs[habitId] || '';
  $('log-time-input').style.setProperty('--hc', habit.color);
  openModal('modal-log');
}

async function saveLog() {
  const val = parseFloat($('log-time-input').value);
  if (isNaN(val) || val < 0) { showToast('Enter a valid number'); return; }
  if (val === 0) {
    await deleteLog(state.logModalHabitId, todayStr());
    delete state.todayLogs[state.logModalHabitId];
  } else {
    await upsertLog(state.logModalHabitId, todayStr(), val, null);
    state.todayLogs[state.logModalHabitId] = val;
  }
  closeModal('modal-log');
  await loadAll();
  await writeRitualSnapshot();
  renderView();
}

// ─── RITUAL SNAPSHOT (for Limitless widget) ──────────────────
async function writeRitualSnapshot() {
  const total = state.habits.length;
  if (total === 0) return;
  const done = state.habits.filter(h => isHabitComplete(h)).length;
  const pct = Math.round((done / total) * 100);
  let bestStreak = 0;
  state.habits.forEach(h => { const s = calcStreak(h.id); if (s > bestStreak) bestStreak = s; });
  try {
    await setUserData('ritual_today_snapshot', {
      pct, done, total, streak: bestStreak,
      updatedAt: new Date().toISOString()
    });
  } catch (e) { /* silent */ }
}

// ─── SETTINGS VIEW ──────────────────────────────────────────
function renderSettings() {
  if (!currentUser) return;
  const email = currentUser.email || '';
  const name = currentUser.user_metadata?.name || currentUser.user_metadata?.full_name || email.split('@')[0] || 'You';

  $('settings-display-name').textContent = name;
  $('settings-email-display').textContent = email;
  $('settings-name-input').value = name;

  // Avatar
  const avatarImg = $('settings-avatar-img');
  const avatarInitials = $('settings-avatar-initials');
  const avatarUrl = currentUser.user_metadata?.avatar_url;
  if (avatarImg && avatarUrl) {
    avatarImg.src = avatarUrl;
    avatarImg.style.display = 'block';
    if (avatarInitials) avatarInitials.style.display = 'none';
  } else {
    if (avatarImg) avatarImg.style.display = 'none';
    if (avatarInitials) {
      avatarInitials.style.display = 'flex';
      avatarInitials.textContent = (name || email || 'U')[0].toUpperCase();
    }
  }

  // Theme
  const savedTheme = localStorage.getItem('ritual_theme') || 'dark';
  document.querySelectorAll('[data-theme-pick]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themePick === savedTheme);
  });

  // Notifications status
  const notifStatus = $('settings-notif-status');
  const notifBtn = $('settings-notif-btn');
  if (notifStatus && notifBtn) {
    const perm = Notification?.permission || 'default';
    if (perm === 'granted') {
      notifStatus.textContent = 'Enabled — you will get daily reminders.';
      notifBtn.textContent = 'Enabled ✓';
      notifBtn.disabled = true;
    } else if (perm === 'denied') {
      notifStatus.textContent = 'Blocked by browser. Go to browser settings to allow.';
      notifBtn.textContent = 'Blocked';
      notifBtn.disabled = true;
    } else {
      notifStatus.textContent = 'Not enabled yet.';
      notifBtn.textContent = 'Enable';
      notifBtn.disabled = false;
    }
  }
}

// ─── EXPORT ──────────────────────────────────────────────────
async function exportAllData() {
  try {
    const habits = state.habits;
    if (habits.length === 0) { showToast('No habits to export'); return; }
    const logs = await getLogsRange('2000-01-01', todayStr());
    let text = `Ritual Export — ${todayStr()}\n${'='.repeat(40)}\n\n`;
    text += `Total Habits: ${habits.length}\nTotal Logs: ${logs.length}\n\n`;
    text += `${'─'.repeat(40)}\nHABITS\n${'─'.repeat(40)}\n\n`;
    habits.forEach(h => {
      const s = logs.filter(l => l.habit_id === h.id).length;
      text += `${h.icon} ${h.name} (${h.type}, target: ${h.target}${h.unit ? ' ' + h.unit : ''})\n`;
      text += `  Total logs: ${s}  Section: ${h.time_of_day}\n\n`;
    });
    text += `${'─'.repeat(40)}\nLOGS\n${'─'.repeat(40)}\n\n`;
    const byDate = {};
    logs.forEach(l => { if (!byDate[l.date]) byDate[l.date] = []; byDate[l.date].push(l); });
    const sortedDates = Object.keys(byDate).sort();
    sortedDates.forEach(d => {
      text += `${d}\n`;
      byDate[d].forEach(l => {
        const h = habits.find(hh => hh.id === l.habit_id);
        if (h) text += `  ${h.icon} ${h.name}: ${l.value}${h.unit ? ' ' + h.unit : ''}\n`;
      });
      text += '\n';
    });
    text += `${'='.repeat(40)}\nEnd of export.\n`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ritual-export-${todayStr()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported ✓');
  } catch (e) {
    showToast('Export failed: ' + e.message);
  }
}

// ─── INSTALL BANNER ──────────────────────────────────────────
let _deferredPrompt = null;
function initInstallBanner() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _deferredPrompt = e;
    const dismissed = localStorage.getItem('ritual_pwa_dismissed');
    if (!dismissed) showInstallBanner();
  });
  window.addEventListener('appinstalled', () => {
    _deferredPrompt = null;
    hideInstallBanner();
    showToast('Ritual installed ✓');
  });
  // iOS detection
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIOS && !navigator.standalone) {
    const dismissed = localStorage.getItem('ritual_pwa_dismissed');
    if (!dismissed) showInstallBanner(true);
  }
}
function showInstallBanner(isIOS = false) {
  const banner = $('pwa-banner');
  if (!banner) return;
  banner.classList.remove('hidden');
  $('pwa-banner-text').textContent = isIOS
    ? 'Install Ritual: tap Share ↑ then Add to Home Screen.'
    : 'Install Ritual for quick access.';
  $('pwa-install-btn').style.display = isIOS ? 'none' : '';
}
function hideInstallBanner() {
  $('pwa-banner')?.classList.add('hidden');
}

// ─── OFFLINE BANNER ─────────────────────────────────────────
function initOfflineDetection() {
  window.addEventListener('offline', () => {
    $('offline-banner')?.classList.remove('hidden');
  });
  window.addEventListener('online', () => {
    $('offline-banner')?.classList.add('hidden');
    showToast('Back online — refreshing…');
    if (currentUser) loadAll().then(() => renderView());
  });
  if (!navigator.onLine) {
    $('offline-banner')?.classList.remove('hidden');
  }
}

// ─── SYNC BADGE ─────────────────────────────────────────────
let _lastSyncTime = null;
function updateSyncBadge() {
  const dot = $('sync-dot');
  const text = $('sync-text');
  if (!dot || !text) return;
  _lastSyncTime = new Date();
  dot.className = 'sync-dot synced';
  text.textContent = 'Synced';
}
function markSyncing() {
  const dot = $('sync-dot');
  const text = $('sync-text');
  if (!dot || !text) return;
  dot.className = 'sync-dot syncing';
  text.textContent = 'Syncing…';
}
// Patch loadAll for sync badge
const _ritualOrigLoadAll = loadAll;
loadAll = async function(opts = {}) {
  markSyncing();
  try { return await _ritualOrigLoadAll(opts); }
  finally { updateSyncBadge(); }
};

// ─── HISTORY VIEW (HEATMAP) ──────────────────────────────────
let heatmapYearOffset = 0;

function renderHistory() {
  const wrap = $('heatmap-wrap');
  if (!wrap) return;

  // Compute target year
  const targetYear = new Date().getFullYear() + heatmapYearOffset;

  // All logs from the user's tracked range
  const habitsCount = state.habits.length;
  const dayMap = {};
  state.yearLogs.forEach(log => {
    const h = state.habits.find(h => h.id === log.habit_id);
    if (!h) return;
    const complete = h.type === 'checkbox' ? log.value >= 1 : log.value >= h.target;
    if (!dayMap[log.date]) dayMap[log.date] = { done: 0, total: habitsCount };
    if (complete) dayMap[log.date].done++;
  });

  // Year label
  $('heatmap-year').textContent = targetYear;

  // Empty state
  const hasAnyData = Object.keys(dayMap).length > 0;
  if (!hasAnyData || habitsCount === 0) {
    wrap.innerHTML = `<div class="empty-state heatmap-empty">
      <span class="empty-icon">▦</span>
      <p>Not enough data yet.<br/>Log some habits to see your heatmap.</p>
    </div>`;
    renderWeeklyBars();
    return;
  }

  // Date range: Jan 1 → Dec 31 (no padding, matches Limitless layout)
  const startDate = new Date(targetYear, 0, 1);
  const endDate = new Date(targetYear, 11, 31);

  // Collect all dates in the year
  const dates = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d));
  }

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  let html = '<div class="heatmap-content">';

  // Month labels
  html += '<div class="heatmap-month-labels">';
  let currentMonth = -1;
  dates.forEach(d => {
    if (d.getMonth() !== currentMonth) {
      currentMonth = d.getMonth();
      html += `<span class="heatmap-month-label">${MONTHS[currentMonth]}</span>`;
    }
  });
  html += '</div>';

  // Cells (flat grid)
  html += '<div class="heatmap-grid">';
  dates.forEach(d => {
    const s = dateStr(d);
    const entry = dayMap[s];
    let level = 0;
    if (entry) {
      const frac = entry.done / Math.max(entry.total, 1);
      if (frac >= 0.25) level = 1;
      if (frac >= 0.5)  level = 2;
      if (frac >= 0.75) level = 3;
      if (frac >= 1)    level = 4;
    }
    const tip = entry ? `${d.toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'})}: ${entry.done}/${entry.total} habits` : d.toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'});
    html += `<div class="heatmap-cell" data-level="${level}" title="${tip}"></div>`;
  });
  html += '</div>';

  // Legend
  html += '<div class="heatmap-legend">Less';
  for (let i = 0; i <= 4; i++) {
    html += `<span class="heatmap-legend-swatch l${i}"></span>`;
  }
  html += 'More</div>';

  html += '</div>'; // close heatmap-content
  wrap.innerHTML = html;

  renderWeeklyBars();
}

function renderWeeklyBars() {
  const el = $('weekly-bars');
  if (!el) return;
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(dateStr(d));
  }

  const habitsCount = state.habits.length;
  el.innerHTML = days.map(ds => {
    const logs = state.yearLogs.filter(l => l.date === ds);
    const done = state.habits.filter(h => {
      const log = logs.find(l => l.habit_id === h.id);
      if (!log) return false;
      return h.type === 'checkbox' ? log.value >= 1 : log.value >= h.target;
    }).length;
    const pct = habitsCount > 0 ? (done / habitsCount) * 100 : 0;
    const label = new Date(ds + 'T12:00:00').toLocaleDateString('en', { weekday: 'short' });
    return `<div class="bar-item">
      <div class="bar-track"><div class="bar-fill" style="height:${pct}%"></div></div>
      <div class="bar-label">${label}</div>
      <div class="bar-val">${done}</div>
    </div>`;
  }).join('');
}

// ─── STATS VIEW ──────────────────────────────────────────────
function renderStats() {
  const habitsCount = state.habits.length;
  const totalLogs = state.yearLogs.length;

  // Best streak across all habits
  const bestStreak = state.habits.reduce((best, h) => Math.max(best, calcStreak(h.id)), 0);

  // Perfect days (all habits done)
  const dayMap = {};
  state.yearLogs.forEach(l => {
    const h = state.habits.find(h => h.id === l.habit_id);
    if (!h) return;
    const done = h.type === 'checkbox' ? l.value >= 1 : l.value >= h.target;
    if (!dayMap[l.date]) dayMap[l.date] = { done: 0 };
    if (done) dayMap[l.date].done++;
  });
  const perfectDays = Object.values(dayMap).filter(d => d.done >= habitsCount && habitsCount > 0).length;

  $('stat-habits').textContent = habitsCount;
  $('stat-logs').textContent = totalLogs;
  $('stat-streak').textContent = bestStreak + 'd';
  $('stat-perfect').textContent = perfectDays;

  // Per-habit stats list
  const list = $('habit-stats-list');
  if (!list) return;
  if (habitsCount === 0) { list.innerHTML = '<p class="empty-note">No habits yet</p>'; return; }
  list.innerHTML = state.habits.map(h => {
    const streak = calcStreak(h.id);
    const logs = state.yearLogs.filter(l => l.habit_id === h.id && (h.type === 'checkbox' ? l.value >= 1 : l.value >= h.target));
    const completionRate = state.yearLogs.filter(l => l.habit_id === h.id).length > 0
      ? Math.round((logs.length / state.yearLogs.filter(l => l.habit_id === h.id).length) * 100)
      : 0;
    return `<div class="habit-stat-row">
      <span class="hsr-icon" style="color:${h.color}">${h.icon}</span>
      <div class="hsr-body">
        <div class="hsr-name">${escHtml(h.name)}</div>
        <div class="hsr-meta">${completionRate}% success · ${logs.length} days logged</div>
      </div>
      <div class="hsr-streak" style="color:${h.color}">${streak}<span>d</span></div>
    </div>`;
  }).join('');
}

// ─── MY HABITS VIEW ──────────────────────────────────────────
function renderHabitsList() {
  const list = $('habits-manage-list');
  if (!list) return;
  if (state.habits.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <span class="empty-icon">◎</span>
      <p>No habits yet.</p>
      <button class="btn-primary" onclick="openHabitModal(null)">+ Add Habit</button>
    </div>`;
    return;
  }
  list.innerHTML = state.habits.map(h => `
    <div class="manage-item" style="border-left:3px solid ${h.color}">
      <span class="manage-icon" style="color:${h.color}">${h.icon}</span>
      <div class="manage-body">
        <div class="manage-name">${escHtml(h.name)}</div>
        <div class="manage-meta">${h.type} · ${h.type !== 'checkbox' ? h.target + ' ' + h.unit + ' · ' : ''}${h.time_of_day}</div>
      </div>
      <div class="manage-actions">
        <button class="btn-icon-sm" onclick="openHabitModal('${h.id}')">Edit</button>
        <button class="btn-icon-sm danger" onclick="handleDeleteHabit('${h.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

// ─── HABIT MODAL ─────────────────────────────────────────────
function openHabitModal(habitId) {
  state.editingHabitId = habitId;
  const h = habitId ? state.habits.find(h => h.id === habitId) : null;
  $('modal-habit-title').textContent = h ? 'Edit Habit' : 'Add Habit';
  $('habit-name-input').value = h?.name || '';
  $('habit-target-input').value = h?.target || 1;
  $('habit-unit-input').value = h?.unit || '';
  // reminder input not used in this version

  // Icon picker
  state.selectedIcon = h?.icon || '◎';
  $$('.icon-btn').forEach(b => b.classList.toggle('selected', b.dataset.icon === state.selectedIcon));

  // Type toggle
  state.selectedType = h?.type || 'checkbox';
  $$('.type-btn').forEach(b => b.classList.toggle('selected', b.dataset.type === state.selectedType));
  updateTypeFields();

  // Time of day
  $('habit-time-select').value = h?.time_of_day || 'any';

  // Color picker
  state.selectedColor = h?.color || HABIT_PALETTE[0];
  $$('.color-dot').forEach(d => d.classList.toggle('selected', d.dataset.color === state.selectedColor));

  openModal('modal-habit');
}

function updateTypeFields() {
  const isCheckbox = state.selectedType === 'checkbox';
  $('habit-target-group').style.display = isCheckbox ? 'none' : 'flex';
}

async function saveHabitForm() {
  const name = $('habit-name-input').value.trim();
  if (!name) { showToast('Enter a habit name'); return; }

  const habit = {
    id: state.editingHabitId || undefined,
    name,
    icon: state.selectedIcon,
    type: state.selectedType,
    target: parseFloat($('habit-target-input').value) || 1,
    unit: $('habit-unit-input').value.trim(),
    time_of_day: $('habit-time-select').value,
    color: state.selectedColor,
    sort_order: state.editingHabitId ? undefined : state.habits.length,
  };

  try {
    await saveHabit(habit);
    closeModal('modal-habit');
    await loadAll();
    renderView();
    showToast(state.editingHabitId ? 'Habit updated' : 'Habit added ✓');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

async function handleDeleteHabit(id) {
  if (!confirm('Delete this habit and all its logs?')) return;
  await deleteHabit(id);
  await loadAll();
  renderView();
  showToast('Habit deleted');
}

// ─── MODALS ──────────────────────────────────────────────────
function openModal(id) {
  $(`${id}`)?.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  $(`${id}`)?.classList.remove('open');
  document.body.style.overflow = '';
}

// ─── THEME ───────────────────────────────────────────────────
function applyTheme() {
  const t = localStorage.getItem('ritual_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
  $('theme-toggle') && ($('theme-toggle').textContent = t === 'dark' ? '◑' : '◐');
}
function cycleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem('ritual_theme', next);
  document.documentElement.setAttribute('data-theme', next);
  $('theme-toggle').textContent = next === 'dark' ? '◑' : '◐';
}

// ─── BIND EVENTS ─────────────────────────────────────────────
function bindEvents() {
  // Auth — email mode
  let authMode = 'signin';
  $('auth-switch-btn')?.addEventListener('click', () => {
    authMode = authMode === 'signin' ? 'signup' : 'signin';
    const isSignup = authMode === 'signup';
    $('email-action-btn').textContent = isSignup ? 'Create Account' : 'Sign In';
    $('auth-switch-text').textContent = isSignup ? 'Already have an account?' : "Don't have an account?";
    $('auth-switch-btn').textContent = isSignup ? 'Sign in' : 'Create one';
    $('auth-confirm-group')?.classList.toggle('hidden', !isSignup);
    $('auth-forgot-btn')?.classList.toggle('hidden', isSignup);
  });

  $('email-action-btn')?.addEventListener('click', async () => {
    const email = $('auth-email').value.trim();
    const pw = $('auth-password').value;
    if (!email || pw.length < 6) { showToast('Enter email + 6+ char password'); return; }
    const btn = $('email-action-btn');
    btn.disabled = true;
    try {
      if (authMode === 'signup') {
        const confirm = $('auth-confirm')?.value;
        if (pw !== confirm) { showToast('Passwords do not match'); return; }
        const data = await signUpWithEmail(email, pw);
        if (data?.user && !data.session) {
          $('auth-verify-msg')?.classList.remove('hidden');
          showToast('Check your email ✉');
        }
      } else {
        await signInWithEmail(email, pw);
      }
    } catch(e) {
      showToast(e.message || 'Auth failed');
    } finally {
      btn.disabled = false;
      btn.textContent = authMode === 'signup' ? 'Create Account' : 'Sign In';
    }
  });

  $('google-signin-btn')?.addEventListener('click', async () => {
    try { await signInWithGoogle(); }
    catch(e) { showToast('Google sign-in failed'); }
  });

  $('auth-forgot-btn')?.addEventListener('click', async () => {
    const email = $('auth-email').value.trim();
    if (!email) { showToast('Enter your email first'); return; }
    await sendPasswordReset(email);
    showToast('Reset email sent ✉');
  });

  $('auth-password')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('email-action-btn').click(); });
  $('auth-email')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('auth-password').focus(); });

  $('toggle-pw')?.addEventListener('click', () => {
    const i = $('auth-password');
    i.type = i.type === 'password' ? 'text' : 'password';
  });

  $('signout-btn')?.addEventListener('click', async () => {
    await signOut();
    state.habits = [];
    state.todayLogs = {};
    state.yearLogs = [];
    showAuth();
  });

  // User pill → settings
  $('user-pill')?.addEventListener('click', () => switchView('settings'));

  // Nav
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      // Close sidebar on mobile after nav tap
      $('sidebar')?.classList.remove('open');
      $('sidebar-overlay')?.classList.remove('visible');
    });
  });

  // Sidebar logo → Today
  $('sidebar-header')?.addEventListener('click', () => {
    if (state.currentView !== 'today') switchView('today');
  });

  // Heatmap year nav
  $('heatmap-prev')?.addEventListener('click', () => { heatmapYearOffset--; renderHistory(); });
  $('heatmap-next')?.addEventListener('click', () => { heatmapYearOffset++; renderHistory(); });

  // Hamburger
  $('hamburger')?.addEventListener('click', () => {
    $('sidebar').classList.toggle('open');
    $('sidebar-overlay').classList.toggle('visible');
  });
  $('sidebar-close')?.addEventListener('click', () => {
    $('sidebar').classList.remove('open');
    $('sidebar-overlay').classList.remove('visible');
  });
  $('sidebar-overlay')?.addEventListener('click', () => {
    $('sidebar').classList.remove('open');
    $('sidebar-overlay').classList.remove('visible');
  });

  // Topbar add
  $('topbar-action')?.addEventListener('click', () => {
    if (state.currentView === 'habits') openHabitModal(null);
    else if (state.currentView === 'today') openHabitModal(null);
    else switchView('habits');
  });

  // Theme
  $('theme-toggle')?.addEventListener('click', cycleTheme);

  // Modal closes
  $$('[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });
  $$('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', e => { if (e.target === bd) closeModal(bd.id); });
  });

  // Habit form
  $('save-habit-btn')?.addEventListener('click', saveHabitForm);
  $('habit-name-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveHabitForm(); });

  // Icon picker
  $$('.icon-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedIcon = btn.dataset.icon;
      $$('.icon-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Type toggle
  $$('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedType = btn.dataset.type;
      $$('.type-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      updateTypeFields();
    });
  });

  // Color picker
  $$('.color-dot').forEach(d => {
    d.addEventListener('click', () => {
      state.selectedColor = d.dataset.color;
      $$('.color-dot').forEach(c => c.classList.remove('selected'));
      d.classList.add('selected');
    });
  });

  // Log modal quick amounts
  $$('.quick-amount').forEach(btn => {
    btn.addEventListener('click', () => {
      const cur = parseFloat($('log-time-input').value) || 0;
      $('log-time-input').value = cur + parseInt(btn.dataset.add);
    });
  });

  $('save-log-btn')?.addEventListener('click', saveLog);

  // Notifications
  $('enable-notif-btn')?.addEventListener('click', async () => {
    await requestNotificationPermission();
    $('notif-banner')?.classList.add('hidden');
  });
  $('dismiss-notif-btn')?.addEventListener('click', () => {
    $('notif-banner')?.classList.add('hidden');
    localStorage.setItem('ritual_notif_dismissed', '1');
  });

  // ══ SETTINGS EVENTS ════════════════════════════════════════

  // Display name
  $('settings-name-save')?.addEventListener('click', async () => {
    const name = $('settings-name-input').value.trim();
    if (!name) { showToast('Enter a name'); return; }
    const btn = $('settings-name-save');
    btn.disabled = true;
    try {
      const { error } = await _sb.auth.updateUser({ data: { name, full_name: name } });
      if (error) throw error;
      if (currentUser) { currentUser.user_metadata.name = name; currentUser.user_metadata.full_name = name; }
      $('user-name').textContent = name;
      $('settings-display-name').textContent = name;
      showToast('Name updated ✓');
    } catch (e) {
      showToast(e.message || 'Failed to update name');
    } finally {
      btn.disabled = false;
    }
  });

  // Change email
  $('settings-email-update')?.addEventListener('click', async () => {
    const email = $('settings-new-email').value.trim();
    if (!email) { showToast('Enter a new email'); return; }
    const btn = $('settings-email-update');
    btn.disabled = true;
    try {
      const { error } = await _sb.auth.updateUser({ email });
      if (error) throw error;
      showToast('Confirmation email sent ✉');
      $('settings-new-email').value = '';
    } catch (e) {
      showToast(e.message || 'Failed to update email');
    } finally {
      btn.disabled = false;
    }
  });

  // Change password
  $('settings-password-change')?.addEventListener('click', async () => {
    const pw = $('settings-new-password').value;
    const confirm = $('settings-confirm-password').value;
    if (pw.length < 6) { showToast('Password must be 6+ characters'); return; }
    if (pw !== confirm) { showToast('Passwords do not match'); return; }
    const btn = $('settings-password-change');
    btn.disabled = true;
    try {
      const { error } = await _sb.auth.updateUser({ password: pw });
      if (error) throw error;
      showToast('Password changed ✓');
      $('settings-new-password').value = '';
      $('settings-confirm-password').value = '';
    } catch (e) {
      showToast(e.message || 'Failed to change password');
    } finally {
      btn.disabled = false;
    }
  });

  // Theme pick
  $$('[data-theme-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.themePick;
      localStorage.setItem('ritual_theme', t);
      document.documentElement.setAttribute('data-theme', t);
      document.querySelectorAll('[data-theme-pick]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('theme-toggle').textContent = t === 'dark' ? '◑' : '◐';
    });
  });

  // Settings notifications
  $('settings-notif-btn')?.addEventListener('click', async () => {
    await requestNotificationPermission();
    renderSettings();
  });

  // Export
  $('settings-export-btn')?.addEventListener('click', exportAllData);

  // Delete all data
  $('settings-delete-all-btn')?.addEventListener('click', async () => {
    if (!confirm('Delete ALL your habits and logs? This cannot be undone.')) return;
    if (!confirm('Are you sure? This is permanent.')) return;
    try {
      for (const h of state.habits) {
        const { error } = await _sb.from('habit_logs').delete().eq('user_id', currentUser.id).eq('habit_id', h.id);
        if (error) throw error;
        await _sb.from('habits').delete().eq('id', h.id).eq('user_id', currentUser.id);
      }
      state.habits = [];
      state.todayLogs = {};
      state.yearLogs = [];
      await loadAll();
      renderView();
      showToast('All data deleted');
    } catch (e) {
      showToast('Error: ' + e.message);
    }
  });

  // Sign out from settings
  $('settings-signout-btn')?.addEventListener('click', async () => {
    if (!confirm('Sign out?')) return;
    await signOut();
    state.habits = [];
    state.todayLogs = {};
    state.yearLogs = [];
    showAuth();
  });

  // ══ INSTALL BANNER ═════════════════════════════════════════
  $('pwa-install-btn')?.addEventListener('click', async () => {
    if (_deferredPrompt) {
      _deferredPrompt.prompt();
      const result = await _deferredPrompt.userChoice;
      if (result.outcome === 'accepted') showToast('Installing Ritual…');
      _deferredPrompt = null;
    }
    hideInstallBanner();
  });
  $('pwa-dismiss-btn')?.addEventListener('click', () => {
    hideInstallBanner();
    localStorage.setItem('ritual_pwa_dismissed', '1');
  });
}

document.addEventListener('DOMContentLoaded', init);