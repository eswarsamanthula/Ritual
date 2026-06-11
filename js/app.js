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
  pendingSkipHabitId: null, // for skip reason modal
  limitlessSnapshot: null,
  limitlessWidgetOn: true,
  stacks: [],
  editingStackId: null,
  selectedStackIcon: '☀',
  selectedStackColor: HABIT_PALETTE[0],
  pairs: [],
  restDays: {},   // { [date]: [habit_id, ...] }
  scoreMode: 'consistency',
  todayNotes: {},
  weekTemplates: {}, // { [habit_id]: [0,1,2,3,4,5,6] }
};

const TODAY = new Date().toISOString().slice(0, 10);
let _showAppGuard = false;

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
  const habit = state.habits.find(h => h.id === habitId);
  if (!habit) return 0;
  const logs = state.yearLogs
    .filter(l => l.habit_id === habitId)
    .reduce((m, l) => { m[l.date] = l.value; return m; }, {});

  let streak = 0;
  const d = new Date();
  while (true) {
    const s = dateStr(d);
    if (s === todayStr() && !logs[s]) { d.setDate(d.getDate() - 1); continue; }
    const val = logs[s];
    if (!isActiveToday(habitId, s)) { streak++; d.setDate(d.getDate() - 1); continue; }
    if (isRestDay(habitId, s)) { streak++; d.setDate(d.getDate() - 1); continue; }
    if (!val || val < habit.target) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function calcMomentumDebt(habitId) {
  const habit = state.habits.find(h => h.id === habitId);
  if (!habit) return 0;
  const habitLogs = state.yearLogs.filter(l => l.habit_id === habitId);
  if (habitLogs.length === 0) return 0;
  const logs = habitLogs.reduce((m, l) => { m[l.date] = l.value; return m; }, {});
  let debt = 0;
  const d = new Date();
  const tVal = logs[todayStr()];
  if (tVal && tVal > 0) d.setDate(d.getDate() - 1);
  while (debt < 30) {
    const s = dateStr(d);
    if (isRestDay(habitId, s)) { d.setDate(d.getDate() - 1); continue; }
    if (!isActiveToday(habitId, s)) { d.setDate(d.getDate() - 1); continue; }
    const val = logs[s];
    if (val === undefined || val <= 0) { debt++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return debt;
}

function calcConsistencyScore() {
  const total = state.habits.length;
  if (total === 0) return 0;
  let sum = 0;
  state.habits.forEach(h => {
    const val = state.todayLogs[h.id] || 0;
    sum += Math.min(1, val / h.target);
  });
  return Math.round((sum / total) * 100);
}

function calcPerfectionScore() {
  const total = state.habits.length;
  if (total === 0) return 0;
  const done = state.habits.filter(h => isHabitComplete(h)).length;
  return Math.round((done / total) * 100);
}

// ─── TIME OF DAY ANALYSIS ────────────────────────────────────
function analyzeTimeOfDay(habitId) {
  const logs = state.yearLogs.filter(l => l.habit_id === habitId && l.logged_at && l.value > 0);
  if (logs.length < 30) return null;
  const buckets = { morning: 0, afternoon: 0, evening: 0, any: 0 };
  logs.forEach(l => {
    const h = new Date(l.logged_at).getHours();
    if (h >= 5 && h < 12) buckets.morning++;
    else if (h >= 12 && h < 17) buckets.afternoon++;
    else if (h >= 17 && h < 23) buckets.evening++;
    else buckets.any++;
  });
  const best = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];
  return { bucket: best[0], count: best[1], total: logs.length, confidence: Math.round((best[1] / logs.length) * 100) };
}

// ─── WEEK TEMPLATE ───────────────────────────────────────────
function isActiveToday(habitId, date) {
  const d = date ? new Date(date + 'T12:00:00').getDay() : new Date().getDay();
  const template = state.weekTemplates[habitId];
  if (!template) return true;
  return template.includes(d);
}
async function saveWeekTemplate() {
  try { await setUserData('week_templates', state.weekTemplates); } catch (_) {}
}
function toggleWeekDay(day) {
  const key = state.editingHabitId || '__new';
  if (!state.weekTemplates[key]) state.weekTemplates[key] = [0, 1, 2, 3, 4, 5, 6];
  const idx = state.weekTemplates[key].indexOf(day);
  if (idx > -1) state.weekTemplates[key].splice(idx, 1);
  else state.weekTemplates[key].push(day);
  document.querySelectorAll('#habit-week-days .weekday-btn').forEach(btn => {
    const d = parseInt(btn.dataset.day);
    btn.classList.toggle('active', state.weekTemplates[key].includes(d));
  });
}

// ─── REST DAYS ────────────────────────────────────────────────
function isRestDay(habitId, date) {
  const d = date || todayStr();
  return state.restDays[d]?.includes(habitId) || false;
}
async function toggleRestDay(habitId) {
  const d = todayStr();
  if (!state.restDays[d]) state.restDays[d] = [];
  const idx = state.restDays[d].indexOf(habitId);
  if (idx > -1) state.restDays[d].splice(idx, 1);
  else state.restDays[d].push(habitId);
  if (state.restDays[d].length === 0) delete state.restDays[d];
  try { await setUserData('rest_days', state.restDays); } catch (_) {}
  renderToday();
}

// ─── HABIT PAIRS ──────────────────────────────────────────────
function loadPairsFromUserData(data) {
  state.pairs = data.habit_pairs || [];
}
async function savePairs() {
  try { await setUserData('habit_pairs', state.pairs); } catch (_) {}
}
function isPairedTrigger(habitId) {
  return state.pairs.some(p => p.trigger_habit_id === habitId && p.enabled !== false);
}
function getPairedActions(triggerHabitId) {
  return state.pairs.filter(p => p.trigger_habit_id === triggerHabitId && p.enabled !== false);
}
async function triggerPairs(triggerHabitId) {
  const actions = getPairedActions(triggerHabitId);
  for (const pair of actions) {
    const target = state.habits.find(h => h.id === pair.triggered_habit_id);
    if (!target) continue;
    if (pair.action === 'auto_complete' && !isHabitComplete(target)) {
      await upsertLog(target.id, todayStr(), target.type === 'checkbox' ? 1 : target.target, null);
      state.todayLogs[target.id] = target.type === 'checkbox' ? 1 : target.target;
    } else if (pair.action === 'open_log') {
      openLogModal(target.id);
    }
  }
}

let _pairingTriggerId = null;
function openPairModal() {
  _pairingTriggerId = state.editingHabitId;
  const targetSel = $('pair-target-select');
  if (targetSel) {
    const others = state.habits.filter(h => h.id !== _pairingTriggerId);
    targetSel.innerHTML = others.map(h => `<option value="${h.id}">${h.icon} ${h.name}</option>`).join('');
  }
  const selAction = document.querySelector('[data-pair-action].selected');
  if (selAction) selAction.classList.remove('selected');
  document.querySelector('[data-pair-action="open_log"]')?.classList.add('selected');
  renderPairList();
  openModal('modal-pair');
}
function renderPairList() {
  const list = $('pair-list');
  if (!list) return;
  const pairs = state.pairs.filter(p => p.trigger_habit_id === _pairingTriggerId);
  if (pairs.length === 0) {
    list.innerHTML = '<span style="font-size:0.72rem;color:var(--text-faint)">No linked habits yet</span>';
    return;
  }
  list.innerHTML = pairs.map(p => {
    const t = state.habits.find(h => h.id === p.triggered_habit_id);
    return `<div class="pair-row">
      <span>${t ? t.icon + ' ' + t.name : 'Unknown'} → ${p.action === 'auto_complete' ? 'auto' : 'open'}</span>
      <button class="pair-remove" onclick="removePair('${p.id}')">✕</button>
    </div>`;
  }).join('');
}
function removePair(id) {
  state.pairs = state.pairs.filter(p => p.id !== id);
  savePairs();
  renderPairList();
}
function addPair() {
  const targetId = $('pair-target-select')?.value;
  if (!targetId) return;
  const actionEl = document.querySelector('[data-pair-action].selected');
  const action = actionEl?.dataset?.pairAction || 'open_log';
  if (state.pairs.some(p => p.trigger_habit_id === _pairingTriggerId && p.triggered_habit_id === targetId)) {
    showToast('Already linked');
    return;
  }
  state.pairs.push({ id: Date.now().toString(), trigger_habit_id: _pairingTriggerId, triggered_habit_id: targetId, action, enabled: true });
  savePairs();
  renderPairList();
}

function bindPairModal() {
  document.querySelectorAll('[data-pair-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-pair-action]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
  $('pair-target-select')?.addEventListener('change', () => {});
}

// ─── INIT ────────────────────────────────────────────────────
async function init() {
  try {
    applyTheme();
    const hasSupabase = initSupabase();

    if (!hasSupabase) {
      $('auth-not-configured')?.classList.remove('hidden');
      $('google-signin-btn').disabled = true;
      $('email-action-btn').disabled = true;
      showAuth();
    } else {
      const session = await getSession();
      if (session && !_showAppGuard) {
        try { await showApp(session.user); } catch (e) { console.error('Init showApp failed:', e); showAuth(); }
      } else if (!session) {
        // Fallback: check localStorage flag for session recovery
        const hasLoggedInBefore = localStorage.getItem('limitless_logged_in');
        if (hasLoggedInBefore && !_showAppGuard) {
          try {
            const retry = await getSession();
            if (retry) { await showApp(retry.user); }
            else { showAuth(); }
          } catch (_) { showAuth(); }
        } else {
          showAuth();
        }
      }
      onAuthChange(async (session, event) => {
        try {
          if (!session) {
            showAuth();
            if (event === 'SIGNED_OUT') { _showAppGuard = false; }
            return;
          }
          localStorage.setItem('limitless_logged_in', '1');
          if (!_showAppGuard) { await showApp(session.user); }
        } catch (e) { console.error('Auth change error:', e); }
      });
    }

    bindEvents();
  } catch (e) {
    console.error('Init failed:', e);
    showAuth();
  }
}

// ─── AUTH SCREENS ────────────────────────────────────────────
function showAuth() {
  const loading = document.getElementById('loading-screen');
  if (loading) loading.classList.add('hidden');
  $('auth-screen').classList.add('active');
  $('app-screen').classList.remove('active');
}

async function showApp(user) {
  if (_showAppGuard) return;
  _showAppGuard = true;

  $('loading-screen')?.classList.add('hidden');

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

  // Load cross-device syncable data from user_data (limitless snapshot, widget toggle)
  if (typeof loadAllUserData === 'function') {
    try {
      const userData = await loadAllUserData();
      if (userData.limitless_today_snapshot) state.limitlessSnapshot = userData.limitless_today_snapshot;
      if (userData.limitless_widget_on === false) {
        state.limitlessWidgetOn = false;
      } else if (userData.limitless_widget_on === true) {
        state.limitlessWidgetOn = true;
      }
      if (userData.habit_stacks) state.stacks = userData.habit_stacks;
    } catch (_) {}
  }

  // Fallback: query accounts directly if snapshot missing
  if (!state.limitlessSnapshot) await fetchLimitlessFallback();

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
      if (typeof loadAllUserData === 'function') {
        try {
          const userData = await loadAllUserData();
          if (userData.limitless_today_snapshot) {
            state.limitlessSnapshot = userData.limitless_today_snapshot;
          } else {
            await fetchLimitlessFallback();
          }
          if (userData.limitless_widget_on === false) {
            state.limitlessWidgetOn = false;
          } else if (userData.limitless_widget_on === true) {
            state.limitlessWidgetOn = true;
          }
          if (userData.habit_stacks) state.stacks = userData.habit_stacks;
        } catch (_) {}
      }
      renderView();
    }, 500);
  });
}

async function loadAll() {
  [state.habits] = await Promise.all([getHabits()]);
  const todayLogs = await getTodayLogs(todayStr());
  state.todayLogs = {};
  state.todayNotes = {};
  todayLogs.forEach(l => {
    state.todayLogs[l.habit_id] = l.value;
    if (l.note) state.todayNotes[l.habit_id] = l.note;
  });

  // Year logs for heatmap + streaks (last 365 days)
  const from = new Date();
  from.setFullYear(from.getFullYear() - 1);
  state.yearLogs = await getLogsRange(dateStr(from), todayStr());

  // Load pairs, rest days, week templates from user_data
  if (typeof loadAllUserData === 'function') {
    try {
      const userData = await loadAllUserData();
      loadPairsFromUserData(userData);
      if (userData.rest_days) state.restDays = userData.rest_days;
      if (userData.week_templates) state.weekTemplates = userData.week_templates;
    } catch (_) {}
  }
}

// ─── VIEW ROUTING ────────────────────────────────────────────
function switchView(view) {
  state.currentView = view;
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`view-${view}`)?.classList.add('active');
  $$('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-view="${view}"]`)?.classList.add('active');
  const titles = { today: 'Today', history: 'History', calendar: 'Calendar', stats: 'Stats', stacks: 'Stacks', habits: 'My Habits', settings: 'Settings' };
  $('view-title').textContent = titles[view] || view;
  renderView();
}

function renderView() {
  if (state.currentView === 'today') renderToday();
  else if (state.currentView === 'history') renderHistory();
  else if (state.currentView === 'calendar') renderCalendar();
  else if (state.currentView === 'stats') renderStats();
  else if (state.currentView === 'stacks') renderStacksView();
  else if (state.currentView === 'habits') renderHabitsList();
  else if (state.currentView === 'settings') renderSettings();
  updateSyncBadge();
}

let calendarMonthOffset = 0;

function renderCalendar() {
  const wrap = $('calendar-wrap');
  if (!wrap) return;
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + calendarMonthOffset;
  while (month < 0) { month += 12; year--; }
  while (month > 11) { month -= 12; year++; }
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const todayStrDate = todayStr();

  // No habits
  if (state.habits.length === 0) {
    wrap.innerHTML = `<div class="cal-nav">
      <button class="cal-nav-btn" onclick="navigateCalendar(-1)">←</button>
      <span class="cal-nav-title">${monthNames[month]} ${year}</span>
      <button class="cal-nav-btn" onclick="navigateCalendar(1)">→</button>
    </div>
    <div class="cal-empty-state">Add some habits to see your calendar</div>`;
    return;
  }

  // Build day map from yearLogs
  const dayMap = {};
  state.yearLogs.forEach(log => {
    const h = state.habits.find(x => x.id === log.habit_id);
    if (!h) return;
    const complete = h.type === 'checkbox' ? log.value >= 1 : log.value >= h.target;
    if (!dayMap[log.date]) dayMap[log.date] = { done: 0, total: 0, logs: [] };
    dayMap[log.date].total++;
    if (complete) dayMap[log.date].done++;
    dayMap[log.date].logs.push(log);
  });

  let html = `<div class="cal-nav">
    <button class="cal-nav-btn" onclick="navigateCalendar(-1)">←</button>
    <span class="cal-nav-title">${monthNames[month]} ${year}</span>
    <button class="cal-nav-btn" onclick="navigateCalendar(1)">→</button>
  </div>
  <div class="cal-grid">
    ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div class="cal-header">${d}</div>`).join('')}`;

  // Blank cells before first day
  const firstDay = new Date(year, month, 1).getDay();
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-cell cal-empty"></div>`;

  // Day cells
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const entry = dayMap[dateStr];
    const hasData = !!entry;
    const pct = entry ? Math.round((entry.done / entry.total) * 100) : 0;
    const level = !hasData ? 0 : pct >= 100 ? 4 : pct >= 75 ? 3 : pct >= 50 ? 2 : 1;
    const isToday = dateStr === todayStrDate;
    html += `<div class="cal-cell ${isToday ? 'cal-today' : ''} ${hasData ? 'has-data' : ''} cal-lvl-${level}" onclick="showDayDetail('${dateStr}', this)">
      <span class="cal-day-num">${d}</span>
    </div>`;
  }

  html += '</div><div id="cal-day-detail" class="cal-day-detail"></div>';

  wrap.innerHTML = html;
}

function navigateCalendar(dir) {
  calendarMonthOffset += dir;
  renderCalendar();
}

function showDayDetail(dateStr, el) {
  const panel = $('cal-day-detail');
  if (!panel) return;
  const existing = panel.dataset.date;
  if (existing === dateStr) { panel.innerHTML = ''; panel.dataset.date = ''; return; }
  panel.dataset.date = dateStr;
  const logs = state.yearLogs.filter(l => l.date === dateStr);
  const todayHabits = state.habits.filter(h =>
    state.todayLogs[h.id] !== undefined && dateStr === todayStr()
  );
  const allLogs = dateStr === todayStr()
    ? todayHabits.map(h => ({ habit_id: h.id, value: state.todayLogs[h.id], note: state.todayNotes[h.id] || null, logged_at: null })).concat(logs.filter(l => !todayHabits.find(h => h.id === l.habit_id)))
    : logs;
  const unique = [];
  const seen = new Set();
  allLogs.forEach(l => {
    if (!seen.has(l.habit_id)) { seen.add(l.habit_id); unique.push(l); }
  });
  if (unique.length === 0) {
    panel.innerHTML = '<div class="cal-detail-empty">Nothing logged this day</div>';
    return;
  }
  panel.innerHTML = unique.map(l => {
    const h = state.habits.find(x => x.id === l.habit_id);
    if (!h) return '';
    const val = l.value || 0;
    const complete = h.type === 'checkbox' ? val >= 1 : val >= h.target;
    const time = l.logged_at ? new Date(l.logged_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return `<div class="cal-detail-row" style="border-left:3px solid ${h.color}">
      <span class="cal-detail-icon">${h.icon}</span>
      <div class="cal-detail-body">
        <span class="cal-detail-name">${escHtml(h.name)}</span>
        <span class="cal-detail-val">${complete ? '✓' : (h.type === 'checkbox' ? '✕' : val + '/' + h.target)}</span>
        ${time ? `<span class="cal-detail-time">${time}</span>` : ''}
        ${l.note ? `<span class="cal-detail-note">${escHtml(l.note)}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ─── TODAY VIEW ──────────────────────────────────────────────
function renderToday() {
  const total = state.habits.length;
  const done = state.habits.filter(h => isHabitComplete(h)).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const cons = calcConsistencyScore();
  const perf = calcPerfectionScore();
  const displayScore = state.scoreMode === 'consistency' ? cons : state.scoreMode === 'perfection' ? perf : pct;

  // Score ring
  const ring = $('score-ring-fill');
  if (ring) {
    const circ = 2 * Math.PI * 30;
    ring.style.strokeDasharray = circ;
    ring.style.strokeDashoffset = circ * (1 - displayScore / 100);
  }
  $('score-pct') && ($('score-pct').textContent = displayScore + '%');
  $('score-label') && ($('score-label').textContent = scoreLabel(pct));
  $('score-sub') && ($('score-sub').textContent = `${done} of ${total} habits done`);

  // Score mode toggle
  const modeEl = $('score-mode-toggle');
  if (modeEl) {
    const modes = ['consistency', 'perfection', 'both'];
    const ms = ['Consistency', 'Perfection', 'Both'];
    modeEl.innerHTML = modes.map((m, i) =>
      `<button class="score-mode-btn ${state.scoreMode === m ? 'active' : ''}" onclick="toggleScoreMode('${m}')">${ms[i]}</button>`
    ).join('');
  }
  const scoreVal = state.scoreMode === 'consistency' ? cons + '%' : state.scoreMode === 'perfection' ? perf + '%' : cons + '% · ' + perf + '%';
  $('score-mode-val') && ($('score-mode-val').textContent = scoreVal);

  // Health score widget
  renderHealthScore(pct);

  // Limitless widget
  renderLimitlessWidget();

  // Habit suggestion
  renderHabitSuggestion();
  // Streak risk alert
  renderStreakRiskBanner();
  // Next up card
  renderNextUp();
  // Stacks today widget
  renderStacksToday();

  // Streak sidebar badge
  renderStreakBadge();

  // Group by time_of_day (only active today)
  const groups = { morning: [], afternoon: [], evening: [], any: [] };
  state.habits.filter(h => isActiveToday(h.id)).forEach(h => groups[h.time_of_day]?.push(h));

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
  if (!isActiveToday(h.id)) return true;
  if (isRestDay(h.id)) return true;
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

// ─── HEALTH SCORE WIDGET ─────────────────────────────────────
function renderHealthScore(pct) {
  const ring = $('health-ring-fill');
  const pctEl = $('health-ring-pct');
  const numEl = $('health-score-num');
  const subEl = $('health-score-sub');
  if (!ring) return;

  const circ = 2 * Math.PI * 22;
  ring.style.strokeDasharray = circ;
  ring.style.strokeDashoffset = circ * (1 - pct / 100);

  // Colour ring by score
  if (pct >= 80) ring.setAttribute('stroke', 'var(--green)');
  else if (pct >= 50) ring.setAttribute('stroke', 'var(--amber)');
  else ring.setAttribute('stroke', 'var(--red)');

  const score = Math.round(pct / 10); // 0–10
  if (pctEl) pctEl.textContent = pct + '%';
  if (numEl) numEl.textContent = score + '/10';
  if (subEl) {
    if (pct === 0)       subEl.textContent = '—';
    else if (pct < 40)   subEl.textContent = 'Needs work';
    else if (pct < 70)   subEl.textContent = 'Decent';
    else if (pct < 90)   subEl.textContent = 'Great shape';
    else                 subEl.textContent = 'Excellent';
  }
}

// ─── LIMITLESS FALLBACK (direct query) ──────────────────────
async function fetchLimitlessFallback() {
  if (!_sb || !currentUser) return;
  try {
    const { data: accounts } = await _sb.from('accounts').select('id, reset_at').eq('user_id', currentUser.id);
    if (!accounts || accounts.length === 0) return;
    const total = accounts.length;
    const available = accounts.filter(a => !a.reset_at || new Date(a.reset_at) <= new Date()).length;
    const healthScore = Math.round((available / total) * 100);
    let streak = 0;
    const { data: ud } = await _sb.from('user_data').select('value').eq('user_id', currentUser.id).eq('key', 'streak').maybeSingle();
    if (ud?.value?.streak) streak = ud.value.streak;
    state.limitlessSnapshot = { healthScore, available, total, streak, updatedAt: new Date().toISOString() };
  } catch (_) {}
}

// ─── LIMITLESS WIDGET ───────────────────────────────────────
function renderLimitlessWidget() {
  const el = document.getElementById('limitless-widget');
  if (!el) return;
  if (!state.limitlessWidgetOn) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  const snap = state.limitlessSnapshot;
  if (!snap || !snap.total || snap.total === 0) {
    el.innerHTML = `
      <div class="limitless-widget-inner">
        <div class="limitless-widget-ring">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34" fill="none" stroke="var(--bg-subtle)" stroke-width="4"/>
          </svg>
        </div>
        <div class="limitless-widget-info">
          <span class="limitless-widget-label">Limitless AI</span>
          <span class="limitless-widget-stat">No accounts tracked yet.</span>
          <span class="limitless-widget-streak">Add accounts to see your AI dashboard</span>
          <div class="limitless-widget-footer">
            <a href="https://applimitlessai.vercel.app" target="_blank" class="limitless-widget-cta">Open Limitless →</a>
          </div>
        </div>
      </div>`;
    return;
  }
  const r = 34;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - snap.healthScore / 100);
  el.innerHTML = `
    <div class="limitless-widget-inner">
      <div class="limitless-widget-ring">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="${r}" fill="none" stroke="var(--bg-subtle)" stroke-width="4"/>
          <circle cx="40" cy="40" r="${r}" fill="none" stroke="var(--accent)" stroke-width="4"
            stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
            stroke-linecap="round" transform="rotate(-90 40 40)"
            style="transition:stroke-dashoffset .6s cubic-bezier(.4,0,.2,1)"/>
        </svg>
        <span class="limitless-widget-pct">${Math.round(snap.healthScore)}%</span>
      </div>
      <div class="limitless-widget-info">
        <span class="limitless-widget-label">Limitless AI</span>
        <span class="limitless-widget-stat">${snap.available} of ${snap.total} accounts ready</span>
        <span class="limitless-widget-streak">🔥 ${snap.streak||0} day streak</span>
        <div class="limitless-widget-footer">
          <a href="https://applimitlessai.vercel.app" target="_blank" class="limitless-widget-cta">Open Limitless →</a>
        </div>
      </div>
    </div>`;
}

function toggleScoreMode(mode) {
  state.scoreMode = mode;
  renderToday();
}

// ─── STREAK SIDEBAR BADGE ────────────────────────────────────
function renderStreakBadge() {
  const badge = $('sidebar-streak-badge');
  const countEl = $('sidebar-streak-count');
  if (!badge) return;

  const bestStreak = state.habits.reduce((best, h) => Math.max(best, calcStreak(h.id)), 0);
  if (bestStreak > 0) {
    countEl.textContent = bestStreak;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ─── STACKS CRUD ────────────────────────────────────────────
function loadStacks() {
  return state.stacks || [];
}
async function saveStacks(stacks) {
  state.stacks = stacks;
  try { await setUserData('habit_stacks', stacks); } catch (_) {}
}

// ─── HABIT SUGGESTION BANNER ────────────────────────────────
function renderHabitSuggestion() {
  const el = document.getElementById('habit-suggest');
  if (!el) return;
  const hour = new Date().getHours();
  let currentWindow = 'any';
  if (hour >= 5 && hour < 12) currentWindow = 'morning';
  else if (hour >= 12 && hour < 17) currentWindow = 'afternoon';
  else if (hour >= 17 && hour < 23) currentWindow = 'evening';

  const windowHabits = state.habits.filter(h =>
    (h.time_of_day === currentWindow || h.time_of_day === 'any') && !isHabitComplete(h)
  );
  if (windowHabits.length === 0) { el.classList.add('hidden'); return; }

  const suggested = windowHabits[0];
  const windowEnd = { morning: '12 PM', afternoon: '5 PM', evening: '11 PM' };

  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="smart-suggest-header">
      <span class="smart-suggest-icon">✦</span>
      <span class="smart-suggest-title">Suggestion</span>
      <button class="smart-suggest-dismiss" id="suggest-dismiss">✕</button>
    </div>
    <div class="smart-suggest-body">
      <strong>${escHtml(suggested.name)}</strong> — You haven't logged it yet today${currentWindow !== 'any' ? `. ${windowEnd[currentWindow]} window still open` : '.'}
    </div>`;
  el.style.borderLeftColor = suggested.color;
  clearTimeout(el._dismissTimer);
  el._dismissTimer = setTimeout(() => el.classList.add('hidden'), 15000);
  const dismissBtn = el.querySelector('#suggest-dismiss');
  if (dismissBtn) {
    dismissBtn.onclick = (e) => { e.stopPropagation(); el.classList.add('hidden'); clearTimeout(el._dismissTimer); };
  }
}

function renderStreakRiskBanner() {
  const el = $('streak-risk-banner');
  if (!el) return;
  const hour = new Date().getHours();
  if (hour < 21) { el.classList.add('hidden'); return; }

  // Load per-day dismissals from localStorage
  const dismissedKey = 'streak_risk_dismissed';
  const todayDismissed = (() => {
    try { const d = JSON.parse(localStorage.getItem(dismissedKey)); return d?.[todayStr()] || []; } catch { return []; }
  })();

  const atRisk = state.habits.filter(h => !isHabitComplete(h) && calcStreak(h.id) >= 7 && !todayDismissed.includes(h.id));
  if (atRisk.length === 0) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = atRisk.map(h => {
    const streak = calcStreak(h.id);
    return `
    <div class="streak-risk-item" style="border-left:3px solid ${h.color}">
      <div class="streak-risk-header">
        <span class="streak-risk-icon">⚠️</span>
        <span class="streak-risk-title">${escHtml(h.name)} — ${streak}d streak at risk</span>
        <button class="streak-risk-dismiss" onclick="dismissStreakRisk('${h.id}')">✕</button>
      </div>
      <div class="streak-risk-body">Log before midnight to keep your streak.</div>
    </div>`;
  }).join('');
}

function dismissStreakRisk(habitId) {
  const key = 'streak_risk_dismissed';
  let data = {};
  try { data = JSON.parse(localStorage.getItem(key)) || {}; } catch {}
  if (!data[todayStr()]) data[todayStr()] = [];
  if (!data[todayStr()].includes(habitId)) data[todayStr()].push(habitId);
  localStorage.setItem(key, JSON.stringify(data));
  renderStreakRiskBanner();
}

// ─── NEXT UP CARD ───────────────────────────────────────────
function renderNextUp() {
  const el = document.getElementById('next-up-card');
  if (!el) return;
  const incomplete = state.habits.filter(h => !isHabitComplete(h));
  if (incomplete.length === 0) { el.innerHTML = ''; el.style.display = 'none'; return; }

  const hour = new Date().getHours();
  let currentWindow = 'any';
  if (hour >= 5 && hour < 12) currentWindow = 'morning';
  else if (hour >= 12 && hour < 17) currentWindow = 'afternoon';
  else if (hour >= 17 && hour < 23) currentWindow = 'evening';

  const sorted = [...incomplete].sort((a, b) => {
    const aWindow = a.time_of_day === currentWindow ? 0 : 1;
    const bWindow = b.time_of_day === currentWindow ? 0 : 1;
    if (aWindow !== bWindow) return aWindow - bWindow;
    const aStreak = calcStreak(a.id) > 0 ? 0 : 1;
    const bStreak = calcStreak(b.id) > 0 ? 0 : 1;
    if (aStreak !== bStreak) return aStreak - bStreak;
    return (a.sort_order || 0) - (b.sort_order || 0);
  });

  const top = sorted.slice(0, 3);
  el.style.display = '';
  el.innerHTML = `<div class="next-up-header"><span class="next-up-title">Next Up</span></div>
    ${top.map(h => {
      const complete = isHabitComplete(h);
      let action = '';
      if (h.type === 'checkbox') {
        action = `<button class="habit-check ${complete ? 'done' : ''}" onclick="toggleCheckbox('${h.id}')" style="--hc:${h.color}">${complete ? '✓' : ''}</button>`;
      } else if (h.type === 'count') {
        action = `<button class="next-up-inc" onclick="adjustCount('${h.id}', 1)" style="color:${h.color}">+1</button>`;
      } else {
        action = `<button class="next-up-inc" onclick="openLogModal('${h.id}')" style="color:${h.color}">Log</button>`;
      }
      const streak = calcStreak(h.id);
      return `<div class="next-up-item" style="--hc:${h.color}">
        <span class="next-up-icon">${escHtml(h.icon)}</span>
        <span class="next-up-name">${escHtml(h.name)}</span>
        ${streak > 0 ? `<span class="next-up-streak">◉ ${streak}d</span>` : ''}
        ${action}
      </div>`;
    }).join('')}`;
}

// ─── STACKS TODAY WIDGET ────────────────────────────────────
function renderStacksToday() {
  const el = document.getElementById('stacks-today-widget');
  if (!el) return;
  const stacks = loadStacks();
  if (stacks.length === 0) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `<div class="stacks-today-header"><span class="stacks-today-title">Stacks</span></div>
    <div class="stacks-today-list">
      ${stacks.map(s => {
        const color = s.color || HABIT_PALETTE[0];
        const habitCount = (s.habit_ids || []).length;
        const doneCount = (s.habit_ids || []).filter(id => state.todayLogs[id] > 0).length;
        const allDone = habitCount > 0 && doneCount === habitCount;
        return `<div class="stacks-today-item" style="--stk-color:${color};opacity:${allDone ? '.5' : '1'}">
          <span class="stacks-today-icon">${s.icon || '⊞'}</span>
          <div class="stacks-today-info">
            <span class="stacks-today-name">${escHtml(s.name)}</span>
            <span class="stacks-today-count">${doneCount}/${habitCount}</span>
          </div>
          <button class="stacks-today-log" onclick="logStack('${s.id}')" ${allDone ? 'disabled' : ''} style="${allDone ? 'opacity:.3' : ''};color:${color}">Log All</button>
        </div>`;
      }).join('')}
    </div>`;
}

// ─── STACKS VIEW ────────────────────────────────────────────
function renderStacksView() {
  const list = document.getElementById('stacks-list');
  if (!list) return;
  const stacks = loadStacks();
  if (stacks.length === 0) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">⊞</span><p>No stacks yet.<br/>Create a stack to batch-log related habits.</p><button class="btn-primary" onclick="openStackModal(null)">+ New Stack</button></div>`;
    return;
  }
  list.innerHTML = stacks.map(s => {
    const color = s.color || HABIT_PALETTE[0];
    const habitNames = (s.habit_ids || []).map(id => state.habits.find(h => h.id === id)).filter(Boolean);
    const habitCount = habitNames.length;
    return `<div class="stack-card" style="--stk-color:${color}">
      <div class="stack-card-main" onclick="openStackModal('${s.id}')">
        <span class="stack-card-icon">${s.icon || '⊞'}</span>
        <div class="stack-card-info">
          <span class="stack-card-name">${escHtml(s.name)}</span>
          <span class="stack-card-count">${habitCount} habits</span>
        </div>
      </div>
      <div class="stack-card-actions">
        <button class="stack-action-btn" onclick="openStackModal('${s.id}')" title="Edit">✎</button>
        <button class="stack-action-btn danger" onclick="deleteStack('${s.id}')" title="Delete">✕</button>
      </div>
    </div>`;
  }).join('');
}

// ─── LOG STACK (one-tap) ────────────────────────────────────
async function logStack(stackId) {
  const stack = loadStacks().find(s => s.id === stackId);
  if (!stack || !stack.habit_ids) return;
  const activeIds = stack.habit_ids.filter(id => state.habits.some(h => h.id === id));
  if (activeIds.length === 0) { showToast('No habits in this stack'); return; }

  let logged = 0;
  for (const id of activeIds) {
    const habit = state.habits.find(h => h.id === id);
    if (!habit || isHabitComplete(habit)) continue;
    if (habit.type === 'checkbox') {
      await upsertLog(id, todayStr(), 1, null);
      state.todayLogs[id] = 1;
      logged++;
    } else if (habit.type === 'count') {
      const cur = state.todayLogs[id] || 0;
      const next = cur + 1;
      await upsertLog(id, todayStr(), next, null);
      state.todayLogs[id] = next;
      logged++;
    } else {
      // time — open log modal for this habit
      openLogModal(id);
      showToast('Log the time habit and continue');
      return;
    }
  }
  await writeRitualSnapshot();
  renderView();
  if (logged > 0) showToast(`Logged ${logged} habit${logged > 1 ? 's' : ''} ✓`);
}

// ─── STACK MODAL ────────────────────────────────────────────
function openStackModal(stackId) {
  state.editingStackId = stackId || null;
  const stack = stackId ? loadStacks().find(s => s.id === stackId) : null;
  $('modal-stack-title').textContent = stack ? 'Edit Stack' : 'New Stack';
  $('stack-name-input').value = stack?.name || '';
  state.selectedStackIcon = stack?.icon || '☀';
  state.selectedStackColor = stack?.color || HABIT_PALETTE[0];

  $$('#stack-icon-grid .icon-btn').forEach(b => b.classList.toggle('selected', b.dataset.icon === state.selectedStackIcon));
  $$('#stack-color-picker .color-dot').forEach(d => d.classList.toggle('selected', d.dataset.color === state.selectedStackColor));

  // Populate habit checkboxes
  const habitList = document.getElementById('stack-habits-checkbox-list');
  if (habitList) {
    const selectedIds = stack?.habit_ids || [];
    if (state.habits.length === 0) {
      habitList.innerHTML = '<span class="checklist-empty" style="font-size:0.75rem;color:var(--text-faint)">No habits yet — create some first.</span>';
    } else {
      habitList.innerHTML = state.habits.map(h => `
        <label class="stack-habit-check">
          <input type="checkbox" value="${h.id}" ${selectedIds.includes(h.id) ? 'checked' : ''} />
          <span class="stack-habit-dot" style="background:${h.color}"></span>
          ${escHtml(h.name)}
        </label>
      `).join('');
    }
  }
  openModal('modal-stack');
}

async function handleSaveStack() {
  const name = $('stack-name-input').value.trim();
  if (!name) { showToast('Enter a stack name'); return; }
  const habitIds = Array.from(document.querySelectorAll('#stack-habits-checkbox-list input[type=checkbox]:checked')).map(cb => cb.value);
  const stacks = loadStacks();
  const stack = { id: state.editingStackId || Date.now().toString(), name, icon: state.selectedStackIcon, color: state.selectedStackColor, habit_ids: habitIds };
  if (state.editingStackId) {
    const idx = stacks.findIndex(s => s.id === state.editingStackId);
    if (idx !== -1) stacks[idx] = stack;
  } else {
    stacks.push(stack);
  }
  await saveStacks(stacks);
  closeModal('modal-stack');
  renderView();
  showToast(state.editingStackId ? 'Stack updated' : 'Stack created ✓');
}

async function deleteStack(id) {
  if (!confirm('Delete this stack? This does not affect your habits.')) return;
  const stacks = loadStacks().filter(s => s.id !== id);
  await saveStacks(stacks);
  renderView();
  showToast('Stack deleted');
}

function buildHabitCard(h) {
  const val = state.todayLogs[h.id] || 0;
  const complete = isHabitComplete(h);
  const pct = h.type === 'checkbox' ? (complete ? 100 : 0) : Math.min(100, (val / h.target) * 100);
  const streak = calcStreak(h.id);
  const debt = calcMomentumDebt(h.id);
  const isRest = isRestDay(h.id);
  const isTrigger = isPairedTrigger(h.id);
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

  const badges = [];
  if (isRest) badges.push(`<span class="rest-badge">⛱ Rest</span>`);
  if (streak > 0) badges.push(`<span class="streak-chip" style="color:${h.color}">◉ ${streak}d</span>`);
  if (debt > 0) badges.push(`<span class="debt-chip" style="color:var(--accent-warm)">−${debt}d</span>`);
  if (isTrigger) badges.push(`<span class="pair-badge">↗</span>`);
  const timeAnalysis = analyzeTimeOfDay(h.id);
  if (timeAnalysis && timeAnalysis.bucket !== h.time_of_day && timeAnalysis.confidence >= 60) {
    badges.push(`<span class="time-suggest-chip" onclick="handleTimeSuggestion('${h.id}','${timeAnalysis.bucket}')" title="Tap to update">🌅 ${timeAnalysis.bucket}</span>`);
  }

  return `<div class="habit-card ${complete ? 'complete' : ''} ${isRest ? 'rest-mode' : ''}" style="--hc:${h.color}">
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
      <div class="habit-meta">${badges.join('')}
        ${h.type !== 'checkbox' ? `<span class="target-chip">${h.target} ${h.unit}</span>` : ''}
      </div>
      ${controls}
      <div class="habit-card-actions">
        <button class="habit-card-menu-btn" onclick="toggleRestDay('${h.id}')" title="${isRest ? 'Unmark rest day' : 'Mark rest day'}">⛱</button>
      </div>
    </div>
  </div>`;
}

// ─── HABIT INTERACTIONS ──────────────────────────────────────
async function toggleCheckbox(habitId) {
  const current = state.todayLogs[habitId] || 0;
  const newVal = current >= 1 ? 0 : 1;
  if (newVal === 0) {
    // Prompt skip reason before clearing
    state.pendingSkipHabitId = habitId;
    const habit = state.habits.find(h => h.id === habitId);
    $('skip-modal-title').textContent = `Why skipping ${habit?.name || 'habit'}?`;
    openModal('modal-skip');
    return;
  } else {
    await upsertLog(habitId, todayStr(), newVal, null);
    state.todayLogs[habitId] = newVal;
  }
  renderToday();
  writeRitualSnapshot();
  triggerPairs(habitId);
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
  triggerPairs(habitId);
}

function openLogModal(habitId) {
  const habit = state.habits.find(h => h.id === habitId);
  if (!habit) return;
  state.logModalHabitId = habitId;
  $('log-modal-title').textContent = habit.name;
  $('log-modal-unit').textContent = habit.unit;
  $('log-time-input').value = state.todayLogs[habitId] || '';
  $('log-time-input').style.setProperty('--hc', habit.color);
  const noteEl = $('log-note-input');
  if (noteEl) noteEl.value = state.todayNotes[habitId] || '';
  openModal('modal-log');
}

async function saveLog() {
  const val = parseFloat($('log-time-input').value);
  if (isNaN(val) || val < 0) { showToast('Enter a valid number'); return; }
  const note = ($('log-note-input')?.value || '').trim() || null;
  if (val === 0) {
    await deleteLog(state.logModalHabitId, todayStr());
    delete state.todayLogs[state.logModalHabitId];
    delete state.todayNotes[state.logModalHabitId];
  } else {
    await upsertLog(state.logModalHabitId, todayStr(), val, note);
    state.todayLogs[state.logModalHabitId] = val;
    if (note) state.todayNotes[state.logModalHabitId] = note;
  }
  closeModal('modal-log');
  await loadAll();
  await writeRitualSnapshot();
  triggerPairs(state.logModalHabitId);
  renderView();
}

// ─── RITUAL SNAPSHOT (for Limitless widget) ──────────────────
async function writeRitualSnapshot() {
  const total = state.habits.length;
  if (total === 0) return;
  const done = state.habits.filter(h => isHabitComplete(h)).length;
  const pct = Math.round((done / total) * 100);
  const consistency = calcConsistencyScore();
  let bestStreak = 0;
  state.habits.forEach(h => { const s = calcStreak(h.id); if (s > bestStreak) bestStreak = s; });
  try {
    await setUserData('ritual_today_snapshot', {
      pct, done, total, consistency, streak: bestStreak,
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

  // Limitless widget toggle state
  const lt = $('limitless-widget-toggle');
  if (lt) {
    lt.textContent = state.limitlessWidgetOn ? 'ON' : 'OFF';
    lt.className = state.limitlessWidgetOn ? 'widget-toggle-btn' : 'widget-toggle-btn off';
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

  // Build both layouts in one pass
  let horizMonthLabels = '<div class="heatmap-month-labels">';
  let horizGrid = '<div class="heatmap-grid">';
  let vertHtml = '';
  let currentMonth = -1;
  let monthCells = [];

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
    const cellHtml = `<div class="heatmap-cell" data-level="${level}" title="${tip}"></div>`;

    horizGrid += cellHtml;

    if (d.getMonth() !== currentMonth) {
      if (currentMonth >= 0) {
        vertHtml += `<div class="hmv-row"><span class="hmv-month">${MONTHS[currentMonth]}</span><div class="hmv-cells">${monthCells.join('')}</div></div>`;
      }
      currentMonth = d.getMonth();
      monthCells = [];
      horizMonthLabels += `<span class="heatmap-month-label">${MONTHS[currentMonth]}</span>`;
    }
    monthCells.push(cellHtml);
  });
  if (currentMonth >= 0) {
    vertHtml += `<div class="hmv-row"><span class="hmv-month">${MONTHS[currentMonth]}</span><div class="hmv-cells">${monthCells.join('')}</div></div>`;
  }
  horizMonthLabels += '</div>';
  horizGrid += '</div>';

  let html = '<div class="heatmap-content">';
  html += `<div class="heatmap-horiz">${horizMonthLabels}${horizGrid}</div>`;
  html += `<div class="heatmap-vert">${vertHtml}</div>`;
  html += '<div class="heatmap-legend">Less';
  for (let i = 0; i <= 4; i++) {
    html += `<span class="heatmap-legend-swatch l${i}"></span>`;
  }
  html += 'More</div>';
  html += '</div>'; // close heatmap-content
  wrap.innerHTML = html;

  renderWeeklyBars();
  renderSkipReasonBars();
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
  const dayData = days.map(ds => {
    const logs = state.yearLogs.filter(l => l.date === ds);
    const done = state.habits.filter(h => {
      const log = logs.find(l => l.habit_id === h.id);
      if (!log) return false;
      return h.type === 'checkbox' ? log.value >= 1 : log.value >= h.target;
    }).length;
    return { ds, done, total: habitsCount };
  });
  const maxDay = Math.max(1, ...dayData.map(d => d.done));
  const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  el.innerHTML = dayData.map((d, i) => {
    const pct = (d.done / maxDay) * 100;
    const high = d.done >= Math.ceil(maxDay * 0.7) ? ' high' : '';
    return `<div class="bar-wrap"><div class="bar-fill${high}" style="height:${Math.max(4, pct)}%" title="${d.ds}: ${d.done}/${d.total} habits"></div><span class="bar-label">${DAYS[i]}</span></div>`;
  }).join('');
}

// ─── SKIP REASON BARS ────────────────────────────────────────
function renderSkipReasonBars() {
  const el = $('skip-reasons-bars');
  const subEl = $('skip-reasons-sub');
  if (!el) return;

  // Collect skip reasons from notes in yearLogs (last 30 days)
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const fromStr = dateStr(from);

  const REASONS = ['Busy', 'Tired', 'Forgot', 'Travel', 'Sick', 'No reason'];
  const counts = {};
  REASONS.forEach(r => counts[r] = 0);

  state.yearLogs.forEach(l => {
    if (l.date < fromStr) return;
    if (l.value !== 0) return; // only skips (logged 0)
    const note = l.note;
    if (note && counts[note] !== undefined) {
      counts[note]++;
    }
  });

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  if (total === 0) {
    el.innerHTML = '<p class="skip-reasons-empty">No skip reasons logged yet. When you uncheck a habit, you\'ll be asked why.</p>';
    if (subEl) subEl.textContent = 'Last 30 days — no data yet';
    return;
  }

  if (subEl) subEl.textContent = `Last 30 days — ${total} skip${total !== 1 ? 's' : ''} logged`;

  const maxCount = Math.max(1, ...Object.values(counts));
  const REASON_COLORS = {
    'Busy': 'var(--amber)',
    'Tired': 'var(--accent)',
    'Forgot': '#89b4c9',
    'Travel': '#c49ac4',
    'Sick': 'var(--red)',
    'No reason': 'var(--text-faint)',
  };

  el.innerHTML = REASONS.filter(r => counts[r] > 0).map(r => {
    const pct = Math.round((counts[r] / maxCount) * 100);
    const color = REASON_COLORS[r] || 'var(--accent)';
    return `<div class="skip-reason-row">
      <span class="skip-reason-label">${r}</span>
      <div class="skip-reason-bar-wrap">
        <div class="skip-reason-bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="skip-reason-count">${counts[r]}</span>
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

  // Week days
  const days = h ? (state.weekTemplates[h.id] || [0,1,2,3,4,5,6]) : [0,1,2,3,4,5,6];
  document.querySelectorAll('#habit-week-days .weekday-btn').forEach(btn => {
    btn.classList.toggle('active', days.includes(parseInt(btn.dataset.day)));
  });

  openModal('modal-habit');
  const pairBtn = $('habit-pair-btn');
  if (pairBtn) pairBtn.style.display = h ? '' : 'none';
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
    const saved = await saveHabit(habit);
    // Save week template
    const activeDays = [];
    document.querySelectorAll('#habit-week-days .weekday-btn.active').forEach(btn => activeDays.push(parseInt(btn.dataset.day)));
    const hid = saved?.id || state.editingHabitId;
    if (hid) {
      if (activeDays.length < 7) state.weekTemplates[hid] = activeDays;
      else delete state.weekTemplates[hid];
      delete state.weekTemplates['__new'];
      await saveWeekTemplate();
    }
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
function resolveTheme(saved) {
  if (saved === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return saved;
}
function applyTheme() {
  const saved = localStorage.getItem('ritual_theme') || 'dark';
  const resolved = resolveTheme(saved);
  document.documentElement.setAttribute('data-theme', resolved);
  const icon = $('theme-toggle');
  if (icon) icon.textContent = saved === 'system' ? '◑' : (resolved === 'dark' ? '◑' : '◐');
}
function cycleTheme() {
  const current = localStorage.getItem('ritual_theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem('ritual_theme', next);
  applyTheme();
}
// Listen for system theme changes
(function() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => {
    if (localStorage.getItem('ritual_theme') === 'system') applyTheme();
  });
})();

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

  // Skip reason buttons
  $$('.skip-reason-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reason = btn.dataset.reason;
      const habitId = state.pendingSkipHabitId;
      if (habitId) {
        // Log 0 with the chosen reason as note
        await upsertLog(habitId, todayStr(), 0, reason);
        state.todayLogs[habitId] = 0;
        state.pendingSkipHabitId = null;
      }
      closeModal('modal-skip');
      renderToday();
      writeRitualSnapshot();
    });
  });

  // "Skip anyway" (no reason) — close modal handler already fires, but we also need to clear log
  document.querySelector('#modal-skip .btn-ghost[data-modal="modal-skip"]')?.addEventListener('click', async () => {
    const habitId = state.pendingSkipHabitId;
    if (habitId) {
      await deleteLog(habitId, todayStr());
      delete state.todayLogs[habitId];
      state.pendingSkipHabitId = null;
    }
    renderToday();
    writeRitualSnapshot();
  });

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
      applyTheme();
      document.querySelectorAll('[data-theme-pick]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Settings notifications
  $('settings-notif-btn')?.addEventListener('click', async () => {
    await requestNotificationPermission();
    renderSettings();
  });

  // Limitless widget toggle
  $('limitless-widget-toggle')?.addEventListener('click', async () => {
    const next = !state.limitlessWidgetOn;
    state.limitlessWidgetOn = next;
    $('limitless-widget-toggle').textContent = next ? 'ON' : 'OFF';
    $('limitless-widget-toggle').className = next ? 'widget-toggle-btn' : 'widget-toggle-btn off';
    try { await setUserData('limitless_widget_on', next); } catch (_) {}
    renderView();
    showToast(next ? 'Limitless widget visible' : 'Limitless widget hidden');
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

  // ══ STACK EVENTS ═══════════════════════════════════════════
  // Stack icon picker
  $$('#stack-icon-grid .icon-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedStackIcon = btn.dataset.icon;
      $$('#stack-icon-grid .icon-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
  // Stack color picker
  $$('#stack-color-picker .color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      state.selectedStackColor = dot.dataset.color;
      $$('#stack-color-picker .color-dot').forEach(d => d.classList.remove('selected'));
      dot.classList.add('selected');
    });
  });
  // Add stack button
  $('add-stack-btn')?.addEventListener('click', () => openStackModal(null));
  // Save stack
  $('save-stack-btn')?.addEventListener('click', handleSaveStack);

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
  // Pair modal
  bindPairModal();
  // Week day toggles
  document.querySelectorAll('#habit-week-days .weekday-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleWeekDay(parseInt(btn.dataset.day)));
  });
}

async function handleTimeSuggestion(habitId, newTime) {
  try {
    await updateHabitTime(habitId, newTime);
    await loadAll();
    renderView();
    showToast('Time updated to ' + newTime);
  } catch(e) { showToast('Failed to update time'); }
}

document.addEventListener('DOMContentLoaded', init);