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
  subscribeRealtime(async (table) => {
    await loadAll();
    renderView();
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
  const titles = { today: 'Today', history: 'History', stats: 'Stats', habits: 'My Habits' };
  $('view-title').textContent = titles[view] || view;
  renderView();
}

function renderView() {
  if (state.currentView === 'today') renderToday();
  else if (state.currentView === 'history') renderHistory();
  else if (state.currentView === 'stats') renderStats();
  else if (state.currentView === 'habits') renderHabitsList();
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
  renderView();
}

// ─── HISTORY VIEW (HEATMAP) ──────────────────────────────────
function renderHistory() {
  const wrap = $('heatmap-wrap');
  if (!wrap) return;

  // Build day→completion map
  const habitsCount = state.habits.length;
  const dayMap = {}; // date → fraction completed

  state.yearLogs.forEach(log => {
    const h = state.habits.find(h => h.id === log.habit_id);
    if (!h) return;
    const complete = h.type === 'checkbox' ? log.value >= 1 : log.value >= h.target;
    if (!dayMap[log.date]) dayMap[log.date] = { done: 0, total: habitsCount };
    if (complete) dayMap[log.date].done++;
  });

  // Build 52-week grid
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 364);
  // Align to Sunday
  start.setDate(start.getDate() - start.getDay());

  const months = [];
  let currentMonth = -1;
  let colIdx = 0;

  let html = '<div class="heatmap-grid">';
  // Month labels row
  html += '<div class="heatmap-months">';
  const tempD = new Date(start);
  for (let w = 0; w < 53; w++) {
    const m = tempD.getMonth();
    if (m !== currentMonth) {
      months.push({ idx: w, label: tempD.toLocaleString('default', { month: 'short' }) });
      currentMonth = m;
    }
    tempD.setDate(tempD.getDate() + 7);
  }
  months.forEach(m => {
    html += `<span class="heatmap-month" style="grid-column:${m.idx + 1}">${m.label}</span>`;
  });
  html += '</div>';

  // Day labels
  html += '<div class="heatmap-days"><span>Mo</span><span></span><span>We</span><span></span><span>Fr</span><span></span><span>Su</span></div>';

  // Cells
  html += '<div class="heatmap-cells">';
  const d = new Date(start);
  for (let w = 0; w < 53; w++) {
    html += '<div class="heatmap-col">';
    for (let day = 0; day < 7; day++) {
      const s = dateStr(d);
      const isFuture = d > today;
      const entry = dayMap[s];
      let level = 0;
      if (entry) {
        const frac = entry.done / Math.max(entry.total, 1);
        if (frac >= 0.25) level = 1;
        if (frac >= 0.5)  level = 2;
        if (frac >= 0.75) level = 3;
        if (frac >= 1)    level = 4;
      }
      const cls = isFuture ? 'hm-cell future' : `hm-cell level-${level}`;
      const tip = entry ? `${formatDate(s)}: ${entry.done}/${entry.total} habits` : formatDate(s);
      html += `<div class="${cls}" title="${tip}" data-date="${s}"></div>`;
      d.setDate(d.getDate() + 1);
    }
    html += '</div>';
  }
  html += '</div></div>';
  wrap.innerHTML = html;

  // Weekly summary
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

  // Nav
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      // Close sidebar on mobile after nav tap
      $('sidebar')?.classList.remove('open');
      $('sidebar-overlay')?.classList.remove('visible');
    });
  });

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
}

document.addEventListener('DOMContentLoaded', init);