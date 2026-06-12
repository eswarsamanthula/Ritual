// ============================================================
//  RITUAL — APP
//  Today view, streaks, heatmap, stats, habit CRUD.
// ============================================================

// ─── STATE ───────────────────────────────────────────────────
const state = {
  habits: [],
  tasks: [],
  todayLogs: {},   // habitId → value
  yearLogs: [],    // all logs for heatmap
  currentView: 'today',
  tasksFilter: 'all',
  editingHabitId: null,
  editingTaskId: null,
  selectedColor: HABIT_PALETTE[0],
  selectedIcon: '◎',
  selectedType: 'checkbox',
  logModalHabitId: null,
  pendingSkipHabitId: null, // for skip reason modal
  limitlessSnapshot: null,
  limitlessWidgetOn: false,
  stacks: [],
  editingStackId: null,
  selectedStackIcon: '☀',
  selectedStackColor: HABIT_PALETTE[0],
  pairs: [],
  restDays: {},   // { [date]: [habit_id, ...] }
  scoreMode: 'consistency',
  todayNotes: {},
  weekTemplates: {}, // { [habit_id]: [0,1,2,3,4,5,6] }
  // New features
  habitGoals: {},  // { [habitId]: { target_value, unit, label, start_date, end_date } }
  timeCapsules: {}, // { [habitId]: { message, created_at, last_shown_milestone } }
  intentions: {},  // { [date]: { morning: string, evening: string, evening_answered: boolean } }
  streakArchaeology: {}, // { [habitId]: { longest_streak, longest_start, longest_end, break_date, break_reason } }
  editingGoalHabitId: null, // for goal modal
  // Witness Mode
  witnessSettings: { mode_on: true, my_witness: { user_id: null, name: '', email: '', status: 'none' }, witness_requests: [], i_witness: [], last_notified_date: '', notifications: [] },
  witnessNotifs: [],
  _witnessUserName: '',
};

let _showAppGuard = false;

// ─── UTILS ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
const haptic = (ms = 10) => { try { navigator.vibrate(ms); } catch (_) {} };
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
  const maxDays = Math.max(state.yearLogs.length, 365) + 7;
  let guard = 0;
  while (guard++ < maxDays) {
    const s = dateStr(d);
    if (s === todayStr() && logs[s] === undefined) { d.setDate(d.getDate() - 1); continue; }
    const val = logs[s];
    if (!isActiveToday(habitId, s)) { streak++; d.setDate(d.getDate() - 1); continue; }
    if (isRestDay(habitId, s)) { streak++; d.setDate(d.getDate() - 1); continue; }
    if (val === undefined || val < habit.target) break;
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
  lsSet('week_templates', state.weekTemplates);
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
  lsSet('rest_days', state.restDays);
  try { await setUserData('rest_days', state.restDays); } catch (_) {}
  renderToday();
}

// ─── HABIT PAIRS ──────────────────────────────────────────────
function loadPairsFromUserData(data) {
  state.pairs = data.habit_pairs || lsGet('habit_pairs', []);
}
async function savePairs() {
  lsSet('habit_pairs', state.pairs);
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
    targetSel.innerHTML = others.map(h => `<option value="${escHtml(h.id)}">${escHtml(h.icon)} ${escHtml(h.name)}</option>`).join('');
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
      <span>${t ? escHtml(t.icon) + ' ' + escHtml(t.name) : 'Unknown'} → ${p.action === 'auto_complete' ? 'auto' : 'open'}</span>
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
        const hasLoggedInBefore = localStorage.getItem('ritual_logged_in');
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
          localStorage.setItem('ritual_logged_in', '1');
          if (!_showAppGuard) { await showApp(session.user); }
        } catch (e) { console.error('Auth change error:', e); }
      });
    }

    bindEvents();
    ptrInit();
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
      avatar.alt = name + ' avatar';
      avatar.style.display = 'block';
    } else {
      avatar.style.display = 'none';
    }
  }

  await seedDefaultHabits();
  await loadAll();

  // Drain any queued writes from offline session
  if (navigator.onLine) await queueDrain();

  // Load cross-device syncable data from user_data (limitless snapshot, widget toggle)
  if (typeof loadAllUserData === 'function') {
    try {
      const userData = await loadAllUserData();
      if (userData.limitless_today_snapshot) state.limitlessSnapshot = userData.limitless_today_snapshot;
      state.limitlessWidgetOn = userData.limitless_widget_on === true ? true
        : lsGet('limitless_widget_on', false);
      state.stacks = userData.habit_stacks || lsGet('habit_stacks', []);
      state.habitGoals = userData.habit_goals || lsGet('habit_goals', {});
      state.timeCapsules = userData.time_capsules || lsGet('time_capsules', {});
      state.intentions = userData.intentions || lsGet('intentions', {});
      state.streakArchaeology = userData.streak_archaeology || lsGet('streak_archaeology', {});
      if (userData.witness_settings) state.witnessSettings = userData.witness_settings;
      else state.witnessSettings = { mode_on: true, my_witness: { user_id: null, name: '', email: '', status: 'none' }, witness_requests: [], i_witness: [], last_notified_date: '', notifications: [] };
    } catch (_) {}
  }

  // Fallback: query accounts directly if snapshot missing
  if (!state.limitlessSnapshot) await fetchLimitlessFallback();

  // Witness Mode: set username + subscribe broadcast + restore persisted notifications
  state._witnessUserName = currentUser?.user_metadata?.name || currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || 'Someone';
  try { state.witnessNotifs = JSON.parse(localStorage.getItem('ritual_witness_notifs') || '[]'); } catch (_) { state.witnessNotifs = []; }
  updateBellDot();

  if (typeof subscribeWitnessBroadcast === 'function') {
    subscribeWitnessBroadcast(currentUser.id,
      (payload) => addWitnessNotification(payload),
      () => { if (typeof loadAll === 'function') loadAll({ silent: true }); }
    );
  }

  renderView();
  initNotifications();
  initInstallBanner();
  initOfflineDetection();

  // Live cross-device sync with 500ms debounce
  let _rtTimer;
  let _rtBusy = false;
  subscribeRealtime(async (table) => {
    if (_rtBusy) return;
    clearTimeout(_rtTimer);
    _rtTimer = setTimeout(async () => {
      if (_rtBusy) return;
      _rtBusy = true;
      try {
        await loadAll();
        if (typeof loadAllUserData === 'function') {
          try {
            const userData = await loadAllUserData();
            if (userData.limitless_today_snapshot) {
              state.limitlessSnapshot = userData.limitless_today_snapshot;
            } else {
              await fetchLimitlessFallback();
            }
            state.limitlessWidgetOn = userData.limitless_widget_on === true ? true
              : lsGet('limitless_widget_on', false);
            state.stacks = userData.habit_stacks || lsGet('habit_stacks', []);
            state.habitGoals = userData.habit_goals || lsGet('habit_goals', {});
            state.timeCapsules = userData.time_capsules || lsGet('time_capsules', {});
            state.intentions = userData.intentions || lsGet('intentions', {});
            state.streakArchaeology = userData.streak_archaeology || lsGet('streak_archaeology', {});
            if (userData.witness_settings) state.witnessSettings = userData.witness_settings;
          } catch (_) {}
        }
        // Only re-render live views on sync; skip expensive views (history, stats etc.)
        if (state.currentView === 'today') renderToday();
      } finally {
        _rtBusy = false;
      }
    }, 500);
  });
}

async function loadAll(opts = {}) {
  const { silent = false } = opts;
  try {
    const from = new Date(); from.setFullYear(from.getFullYear() - 1);
    const [habitsRes, logsRes, yearRes, tasksRes] = await Promise.allSettled([
      getHabits(),
      getTodayLogs(todayStr()),
      getLogsRange(dateStr(from), todayStr()),
      getTasks(),
    ]);
    state.habits = habitsRes.value || [];
    state.tasks = tasksRes.status === 'fulfilled' ? (tasksRes.value || []) : (cacheLoad('tasks') || []);
    state.yearLogs = yearRes.status === 'fulfilled' ? (yearRes.value || []) : (cacheLoad('yearLogs') || []);
    state._heatmapLoaded = true;
    state.todayLogs = {};
    state.todayNotes = {};
    (logsRes.value || []).forEach(l => {
      state.todayLogs[l.habit_id] = l.value;
      if (l.note) state.todayNotes[l.habit_id] = l.note;
    });


    // Cache today data to localStorage for offline use
    cacheSave('habits', state.habits);
    cacheSave('tasks', state.tasks);
    cacheSave('todayLogs', state.todayLogs);
    cacheSave('todayNotes', state.todayNotes);
    cacheSave('yearLogs', state.yearLogs);

    // Load pairs, rest days, week templates from user_data
    if (typeof loadAllUserData === 'function') {
      try {
        const userData = await loadAllUserData();
        loadPairsFromUserData(userData);
        state.restDays = userData.rest_days || lsGet('rest_days', {});
        state.weekTemplates = userData.week_templates || lsGet('week_templates', {});
        state.habitGoals = userData.habit_goals || lsGet('habit_goals', {});
        state.timeCapsules = userData.time_capsules || lsGet('time_capsules', {});
        state.intentions = userData.intentions || lsGet('intentions', {});
        state.streakArchaeology = userData.streak_archaeology || lsGet('streak_archaeology', {});
        if (userData.witness_settings) state.witnessSettings = userData.witness_settings;
      } catch (_) {}
    }
    $('offline-banner')?.classList.add('hidden');
  } catch (e) {
    console.error('Load error:', e);
    if (!navigator.onLine) {
      // offline — restore from cache
      const habits = cacheLoad('habits');
      const tasks = cacheLoad('tasks');
      const todayLogs = cacheLoad('todayLogs');
      const todayNotes = cacheLoad('todayNotes');
      const yearLogs = cacheLoad('yearLogs');
      if (habits) state.habits = habits;
      if (tasks) state.tasks = tasks;
      if (todayLogs) state.todayLogs = todayLogs;
      if (todayNotes) state.todayNotes = todayNotes;
      if (yearLogs) state.yearLogs = yearLogs;
      if (!silent) $('offline-banner')?.classList.remove('hidden');
    } else if (!silent) {
      showToast('Failed to load data — pull to refresh');
    }
  }
}

// ─── VIEW ROUTING ────────────────────────────────────────────
function switchView(view) {
  state.currentView = view;
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`view-${view}`)?.classList.add('active');
  $$('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-view="${view}"]`)?.classList.add('active');
  const titles = { today: 'Today', tasks: 'Tasks', history: 'History', calendar: 'Calendar', stats: 'Stats', stacks: 'Stacks', habits: 'My Habits', settings: 'Settings', correlations: 'Correlations', witness: 'Witness' };
  $('view-title').textContent = titles[view] || view;
  renderView();
}

function renderView() {
  if (state.currentView === 'today') renderToday();
  else if (state.currentView === 'tasks') renderTasksView();
  else if (state.currentView === 'history') renderHistory();
  else if (state.currentView === 'calendar') renderCalendar();
  else if (state.currentView === 'stats') renderStats();
  else if (state.currentView === 'stacks') renderStacksView();
  else if (state.currentView === 'habits') renderHabitsList();
  else if (state.currentView === 'settings') renderSettings();
  else if (state.currentView === 'correlations') renderCorrelationsView();
  else if (state.currentView === 'witness') renderWitnessView();
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

  // Build task due date map
  const taskDateMap = {};
  state.tasks.forEach(t => {
    if (t.due_date) {
      if (!taskDateMap[t.due_date]) taskDateMap[t.due_date] = [];
      taskDateMap[t.due_date].push(t);
    }
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
    const hasTasks = !!taskDateMap[dateStr];
    html += `<div class="cal-cell ${isToday ? 'cal-today' : ''} ${hasData ? 'has-data' : ''} cal-lvl-${level}" onclick="showDayDetail('${dateStr}', this)">
      <span class="cal-day-num">${d}</span>
      ${hasTasks ? '<span class="cal-task-dot"></span>' : ''}
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
  let html = '';
  if (unique.length > 0) {
    html += unique.map(l => {
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
  // Show tasks due on this date
  const dueTasks = state.tasks.filter(t => t.due_date === dateStr);
  if (dueTasks.length > 0) {
    html += `<div class="cal-detail-section-label">Tasks Due</div>`;
    html += dueTasks.map(t => {
      const done = t.status === 'completed';
      return `<div class="cal-detail-row cal-task-row" style="border-left:3px solid ${done ? 'var(--green)' : 'var(--accent)'}">
        <span class="cal-detail-icon">${done ? '✓' : '☐'}</span>
        <div class="cal-detail-body">
          <span class="cal-detail-name ${done ? 'cal-detail-done' : ''}">${escHtml(t.title)}</span>
          ${t.priority > 0 ? '<span class="cal-detail-val" style="color:var(--accent-warm)">high</span>' : ''}
        </div>
      </div>`;
    }).join('');
  }
  if (!html) {
    panel.innerHTML = '<div class="cal-detail-empty">Nothing logged this day</div>';
    return;
  }
  panel.innerHTML = html;
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
  // Tasks today widget
  renderTasksToday();

  // Streak sidebar badge
  renderStreakBadge();

  // Group by time_of_day (only active today)
  const groups = { morning: [], afternoon: [], evening: [], any: [] };
  state.habits.filter(h => isActiveToday(h.id)).forEach(h => groups[h.time_of_day]?.push(h));

  const grid = $('habits-grid');
  if (!grid) return;

  if (total === 0) {
    grid.innerHTML = `<div class="empty-state">
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:0.5rem;opacity:.6">
        <circle cx="40" cy="40" r="28" stroke="var(--border)"/>
        <path d="M30 40l8 8 14-14" stroke="var(--accent)"/>
        <path d="M22 28a20 20 0 0 0 0 24" stroke="var(--text-faint)" stroke-width="1"/>
        <path d="M58 28a20 20 0 0 1 0 24" stroke="var(--text-faint)" stroke-width="1"/>
      </svg>
      <p>No habits yet.<br/>Add your first one to begin.</p>
      <button class="btn-primary" onclick="openHabitModal(null)">+ Add Habit</button>
    </div>`;
    return;
  }

  const groupOrder = ['morning', 'afternoon', 'evening', 'any'];
  const groupLabels = { morning: '☀ Morning', afternoon: '◑ Afternoon', evening: '◐ Evening', any: '◎ Anytime' };

  let cardIdx = 0;
  grid.innerHTML = groupOrder.map(g => {
    if (!groups[g] || groups[g].length === 0) return '';
    const cards = groups[g].map(h => {
      const html = buildHabitCard(h, cardIdx);
      cardIdx++;
      return html;
    }).join('');
    return `
      <div class="group-section">
        <div class="group-label">${groupLabels[g]}</div>
        <div class="habit-cards">
          ${cards}
        </div>
      </div>`;
  }).join('');
  renderIntention();
  renderTimeCapsules();
  renderStreakEulogy();
  checkStreakMilestones();
  checkPerfectDay();
  // Check streak archaeology for newly broken streaks
  state.habits.forEach(h => updateStreakArchaeology(h.id));
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
  countEl.textContent = bestStreak;
  badge.classList.remove('hidden');
}

// ─── STACKS CRUD ────────────────────────────────────────────
function loadStacks() {
  return state.stacks || [];
}
async function saveStacks(stacks) {
  state.stacks = stacks;
  lsSet('habit_stacks', stacks);
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

// ─── TASKS TODAY WIDGET ────────────────────────────────────
function renderTasksToday() {
  const el = document.getElementById('tasks-today-widget');
  if (!el) return;
  const pending = state.tasks.filter(t => t.status === 'pending');
  if (pending.length === 0) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  const todayDue = pending.filter(t => t.due_date === todayStr());
  const other = pending.filter(t => t.due_date !== todayStr());
  const sorted = [...todayDue.sort((a, b) => b.priority - a.priority), ...other.sort((a, b) => b.priority - a.priority)].slice(0, 6);
  el.innerHTML = `<div class="tasks-today-header"><span class="tasks-today-title">Tasks Today</span><span class="tasks-today-count">${pending.length}</span></div>
    <div class="tasks-today-list">
      ${sorted.map(t => {
        const isDue = t.due_date === todayStr();
        const pCls = t.priority > 0 ? 'high' : t.priority < 0 ? 'low' : '';
        const g = t.time_of_day === 'any' ? '' : t.time_of_day;
        return `<div class="tasks-today-item ${pCls}">
          <button class="task-check-today" onclick="handleToggleTask('${t.id}')">○</button>
          <div class="tasks-today-info">
            <span class="tasks-today-name">${escHtml(t.title)}</span>
            ${g ? `<span class="tasks-today-time">${g}</span>` : ''}
          </div>
          ${isDue ? '<span class="tasks-today-due">Today</span>' : ''}
        </div>`;
      }).join('')}
      ${pending.length > 6 ? `<button class="tasks-today-more" onclick="switchView('tasks')">+${pending.length - 6} more</button>` : ''}
    </div>`;
}

// ─── TASKS VIEW ────────────────────────────────────────────
function renderTasksView() {
  const list = $('tasks-list');
  if (!list) return;
  const filter = state.tasksFilter || 'all';
  const filtered = state.tasks.filter(t => filter === 'all' ? true : t.status === filter);
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:0.5rem;opacity:.6">
        <rect x="14" y="14" width="44" height="10" rx="3" stroke="var(--border)"/>
        <rect x="14" y="30" width="44" height="10" rx="3" stroke="var(--accent)"/>
        <rect x="14" y="46" width="44" height="10" rx="3" stroke="var(--text-faint)" stroke-width="1"/>
      </svg>
      <p>${filter === 'all' ? 'No tasks yet.<br/>Add a task to get started.' : filter === 'completed' ? 'No completed tasks yet.' : 'All tasks done! 🎉'}</p>
      <button class="btn-primary" onclick="openTaskModal(null)">+ Add Task</button>
    </div>`;
    return;
  }
  const groups = { morning: [], afternoon: [], evening: [], any: [] };
  filtered.forEach(t => groups[t.time_of_day]?.push(t));
  const groupOrder = ['morning', 'afternoon', 'evening', 'any'];
  const groupLabels = { morning: '☀ Morning', afternoon: '◑ Afternoon', evening: '◐ Evening', any: '◎ Anytime' };
  list.innerHTML = groupOrder.map(g => {
    if (!groups[g] || groups[g].length === 0) return '';
    const items = groups[g].sort((a, b) => b.priority - a.priority).map(t => {
      const pCls = t.priority > 0 ? 'high' : t.priority < 0 ? 'low' : '';
      const isDue = t.due_date === todayStr();
      const deadline = t.due_date ? (isDue ? 'Today' : formatDate(new Date(t.due_date + 'T12:00:00'))) : '';
      return `<div class="task-card ${t.status} ${pCls}" style="--hc:${t.priority > 0 ? 'var(--accent-warm)' : 'var(--accent)'}">
        <button class="task-check" onclick="handleToggleTask('${t.id}')" style="--hc:${t.priority > 0 ? 'var(--accent-warm)' : 'var(--accent)'}">${t.status === 'completed' ? '✓' : '○'}</button>
        <div class="task-body">
          <div class="task-title">${escHtml(t.title)}</div>
          ${t.description ? `<div class="task-desc">${escHtml(t.description)}</div>` : ''}
          <div class="task-meta">
            ${deadline ? `<span class="task-due ${isDue ? 'urgent' : ''}">${deadline}</span>` : ''}
            ${t.priority > 0 ? '<span class="task-priority-badge">!</span>' : ''}
          </div>
        </div>
        <div class="task-actions">
          <button class="task-edit-btn" onclick="openTaskModal('${t.id}')" title="Edit">✎</button>
          <button class="task-del-btn" onclick="handleDeleteTask('${t.id}')" title="Delete">✕</button>
        </div>
      </div>`;
    }).join('');
    return `<div class="group-section"><div class="group-label">${groupLabels[g]}</div><div class="task-cards">${items}</div></div>`;
  }).join('');
}

// ─── TASK MODAL ────────────────────────────────────────────
function openTaskModal(taskId) {
  state.editingTaskId = taskId || null;
  const task = taskId ? state.tasks.find(t => t.id === taskId) : null;
  $('modal-task-title').textContent = task ? 'Edit Task' : 'Add Task';
  $('task-title-input').value = task?.title || '';
  $('task-desc-input').value = task?.description || '';
  $('task-due-input').value = task?.due_date || '';
  $('task-time-select').value = task?.time_of_day || 'any';
  const prio = task?.priority || 0;
  $$('#task-priority-toggle .type-btn').forEach(b => b.classList.toggle('selected', parseInt(b.dataset.priority) === prio));
  $('task-delete-btn').style.display = task ? '' : 'none';
  openModal('modal-task');
  setTimeout(() => $('task-title-input')?.focus(), 100);
}

async function handleSaveTask() {
  const title = $('task-title-input').value.trim();
  if (!title) { showToast('Enter a task title'); return; }
  const desc = $('task-desc-input').value.trim();
  const due = $('task-due-input').value || null;
  const timeOfDay = $('task-time-select').value;
  const prioEl = document.querySelector('#task-priority-toggle .type-btn.selected');
  const priority = parseInt(prioEl?.dataset?.priority || '0');
  const task = {
    id: state.editingTaskId,
    title,
    description: desc,
    due_date: due,
    time_of_day: timeOfDay,
    priority,
    status: state.editingTaskId ? (state.tasks.find(t => t.id === state.editingTaskId)?.status || 'pending') : 'pending',
    sort_order: state.editingTaskId ? (state.tasks.find(t => t.id === state.editingTaskId)?.sort_order || 0) : state.tasks.length,
  };
  try {
    await saveTask(task);
    closeModal('modal-task');
    await loadAll();
    renderView();
    showToast(state.editingTaskId ? 'Task updated ✓' : 'Task added ✓');
  } catch (e) {
    showToast('Failed to save task: ' + (e.message || ''));
  }
}

async function handleDeleteTask(id) {
  if (!confirm('Delete this task?')) return;
  try {
    await deleteTask(id);
    await loadAll();
    renderView();
    showToast('Task deleted');
  } catch (e) {
    showToast('Failed to delete task');
  }
}

async function handleToggleTask(id) {
  haptic();
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  const newStatus = task.status === 'completed' ? 'pending' : 'completed';
  // Optimistic
  task.status = newStatus;
  if (state.currentView === 'tasks') renderTasksView();
  else if (state.currentView === 'today') renderToday();
  try {
    await toggleTask(id, newStatus);
    await loadAll({ silent: true });
  } catch (e) {
    showToast('Failed to update task');
    await loadAll();
    if (state.currentView === 'tasks') renderTasksView();
    else if (state.currentView === 'today') renderToday();
  }
}

function buildHabitCard(h, idx = 0) {
  const val = state.todayLogs[h.id] || 0;
  const complete = isHabitComplete(h);
  const pct = h.type === 'checkbox' ? (complete ? 100 : 0) : Math.min(100, (val / h.target) * 100);
  const streak = calcStreak(h.id);
  const debt = calcMomentumDebt(h.id);
  const isRest = isRestDay(h.id);
  const isTrigger = isPairedTrigger(h.id);
  const circ = 2 * Math.PI * 22;
  const offset = circ * (1 - pct / 100);

  const checkMarkSvg = `<svg viewBox="0 0 18 18"><polyline class="check-path${complete ? '' : ' instant'}" points="4,9 8,13 14,5"/></svg>`;

  let controls = '';
  if (h.type === 'checkbox') {
    controls = `<button class="habit-check ${complete ? 'done' : ''}" onclick="toggleCheckbox('${h.id}')" style="--hc:${h.color}">
      ${checkMarkSvg}
    </button>`;
  } else if (h.type === 'count') {
    controls = `<div class="count-controls">
      <button class="count-btn" onclick="adjustCount('${h.id}', -1)">−</button>
      <span class="count-val"><span class="count-num" id="count-${h.id}">${val}</span><span class="count-unit">/${h.target}</span></span>
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
  if (state.habitGoals[h.id]) badges.push(`<span class="goal-chip" onclick="openGoalModal('${h.id}')" title="View goal">🎯</span>`);
  const timeAnalysis = analyzeTimeOfDay(h.id);
  if (timeAnalysis && timeAnalysis.bucket !== h.time_of_day && timeAnalysis.confidence >= 60) {
    badges.push(`<span class="time-suggest-chip" onclick="handleTimeSuggestion('${h.id}','${timeAnalysis.bucket}')" title="Tap to update">🌅 ${timeAnalysis.bucket}</span>`);
  }

  return `<div class="habit-card ${complete ? 'complete' : ''} ${isRest ? 'rest-mode' : ''}" style="--hc:${h.color};--i:${idx}">
    <div class="habit-card-left">
      <div class="habit-ring-wrap">
        <svg width="52" height="52" viewBox="0 0 52 52">
          <circle cx="26" cy="26" r="22" fill="none" stroke="var(--ring-track)" stroke-width="3"/>
          <circle cx="26" cy="26" r="22" fill="none" stroke="${h.color}" stroke-width="3"
            stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
            stroke-linecap="round" transform="rotate(-90 26 26)"
            style="transition:stroke-dashoffset .6s cubic-bezier(.34,1.56,.64,1)"/>
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
  haptic();
  const current = state.todayLogs[habitId] || 0;
  const newVal = current >= 1 ? 0 : 1;
  if (newVal === 0) {
    state.pendingSkipHabitId = habitId;
    const habit = state.habits.find(h => h.id === habitId);
    $('skip-modal-title').textContent = `Why skipping ${habit?.name || 'habit'}?`;
    openModal('modal-skip');
    return;
  } else {
    // Optimistic UI: show done state immediately
    const btn = document.querySelector(`.habit-check[onclick*="'${habitId}'"]`);
    if (btn) btn.classList.add('done');
    _perfectDayFired = false;
    await upsertLog(habitId, todayStr(), newVal, null);
    state.todayLogs[habitId] = newVal;
  }
  renderToday();
  writeRitualSnapshot();
  triggerPairs(habitId);
}

async function adjustCount(habitId, delta) {
  haptic();
  const habit = state.habits.find(h => h.id === habitId);
  if (!habit) return;
  const current = state.todayLogs[habitId] || 0;
  const next = Math.max(0, current + delta);

  // Animate the number roll
  const numEl = document.getElementById(`count-${habitId}`);
  if (numEl) {
    numEl.classList.add('roll-out');
    await new Promise(r => setTimeout(r, 80));
    numEl.textContent = next;
    numEl.classList.remove('roll-out');
    numEl.classList.add('roll-in');
    setTimeout(() => numEl.classList.remove('roll-in'), 250);
  }

  if (next === 0) {
    await deleteLog(habitId, todayStr());
    delete state.todayLogs[habitId];
  } else {
    _perfectDayFired = false;
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

  // Witness mode toggle + detail
  const wmBtn = $('witness-mode-btn');
  if (wmBtn) {
    wmBtn.textContent = state.witnessSettings.mode_on ? 'ON' : 'OFF';
    wmBtn.className = state.witnessSettings.mode_on ? 'widget-toggle-btn' : 'widget-toggle-btn off';
  }
  renderWitnessSettingsDetail();
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
  window.addEventListener('online', async () => {
    $('offline-banner')?.classList.add('hidden');
    await queueDrain();
    if (currentUser) await loadAll({ silent: true });
    renderView();
    const q = queueSize();
    showToast(q > 0 ? `${q} change${q > 1 ? 's' : ''} pending sync` : 'Back online — refreshed ✓');
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
  if (!navigator.onLine || queueSize() > 0) {
    const q = queueSize();
    dot.className = 'sync-dot offline';
    text.textContent = q > 0 ? `${q} pending` : 'Offline';
  } else {
    dot.className = 'sync-dot synced';
    text.textContent = 'Synced';
  }
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
let _heatmapLoading = false;

async function ensureHeatmapData() {
  if (state.yearLogs && state._heatmapLoaded) return;
  if (_heatmapLoading) return;
  _heatmapLoading = true;
  try {
    const from = new Date();
    from.setFullYear(from.getFullYear() - 1);
    state.yearLogs = await getLogsRange(dateStr(from), todayStr());
    cacheSave('yearLogs', state.yearLogs);
  } catch (_) {
    const cached = cacheLoad('yearLogs');
    if (cached) state.yearLogs = cached;
  } finally {
    state._heatmapLoaded = true;
    _heatmapLoading = false;
  }
}

async function renderHistory() {
  const wrap = $('heatmap-wrap');
  if (!wrap) return;

  if (!state.yearLogs || !state._heatmapLoaded) {
    await ensureHeatmapData();
    if (!state.yearLogs || !state._heatmapLoaded) return;
  }

  // Compute target year
  const targetYear = new Date().getFullYear() + heatmapYearOffset;

  // All logs from the user's tracked range
  const habitsCount = state.habits.length;
  const dayMap = {};
  (state.yearLogs || []).forEach(log => {
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
  const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(dateStr(d));
  }

  // Build a date→logs lookup map (O(n) once instead of O(7×n) with filter per day)
  const logMap = {};
  const habitsCount = state.habits.length;
  for (const l of state.yearLogs) {
    if (!logMap[l.date]) logMap[l.date] = [];
    logMap[l.date].push(l);
  }

  const dayData = days.map(ds => {
    const logs = logMap[ds] || [];
    let done = 0;
    for (const h of state.habits) {
      const log = logs.find(l => l.habit_id === h.id);
      if (!log) continue;
      if (h.type === 'checkbox' ? log.value >= 1 : log.value >= h.target) done++;
    }
    return { ds, done, total: habitsCount };
  });
  const maxDay = Math.max(1, ...dayData.map(d => d.done));
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

  renderGoalProgress();
  renderCorrelationsInner($('correlations-stats-list'));
}

// ─── MY HABITS VIEW ──────────────────────────────────────────
function renderHabitsList() {
  const list = $('habits-manage-list');
  if (!list) return;
  if (state.habits.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:0.5rem;opacity:.6">
        <circle cx="36" cy="28" r="12" stroke="var(--border)"/>
        <path d="M18 60c0-10 8-18 18-18s18 8 18 18" stroke="var(--text-faint)" stroke-width="1"/>
        <path d="M52 14l6 6-6 6" stroke="var(--accent)"/>
        <path d="M14 14l6 6-6 6" stroke="var(--text-faint)" stroke-width="1"/>
      </svg>
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
        <button class="btn-icon-sm" onclick="openGoalModal('${h.id}')">Goal</button>
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

  // Time capsule
  const capEl = $('habit-capsule-input');
  if (capEl) capEl.value = state.timeCapsules[h?.id]?.message || '';

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
    // Save time capsule message
    const capEl = $('habit-capsule-input');
    const capMsg = capEl?.value.trim() || '';
    if (hid) await saveCapsule(hid, capMsg);
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
  // Clean up associated data
  delete state.habitGoals[id];
  delete state.timeCapsules[id];
  delete state.streakArchaeology[id];
  lsSet('habit_goals', state.habitGoals);
  lsSet('time_capsules', state.timeCapsules);
  lsSet('streak_archaeology', state.streakArchaeology);
  try { await Promise.allSettled([
    setUserData('habit_goals', state.habitGoals),
    setUserData('time_capsules', state.timeCapsules),
    setUserData('streak_archaeology', state.streakArchaeology),
  ]); } catch (_) {}
  await loadAll();
  renderView();
  showToast('Habit deleted');
}

// ─── MODALS ──────────────────────────────────────────────────
let _modalOpenCount = 0;
let _lastFocusedEl = null;
function openModal(id) {
  _lastFocusedEl = document.activeElement;
  $$('.modal-backdrop.open').forEach(m => {
    if (m.id !== id) m.classList.remove('open');
  });
  const el = $(`${id}`);
  if (el) {
    el.classList.add('open');
    const first = el.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    first?.focus();
  }
  _modalOpenCount = $$('.modal-backdrop.open').length;
  document.body.style.overflow = _modalOpenCount > 0 ? 'hidden' : '';
}
function closeModal(id) {
  $(`${id}`)?.classList.remove('open');
  _modalOpenCount = $$('.modal-backdrop.open').length;
  document.body.style.overflow = _modalOpenCount > 0 ? 'hidden' : '';
  if (id === 'modal-skip') state.pendingSkipHabitId = null;
  if (_lastFocusedEl) { _lastFocusedEl.focus(); _lastFocusedEl = null; }
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const openModals = $$('.modal-backdrop.open');
    if (openModals.length) closeModal(openModals[openModals.length - 1].id);
  }
});

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

// ─── CONFETTI SYSTEM ────────────────────────────────────────────
const _milestones = [3, 7, 14, 21, 30, 60, 90, 180, 365];
let _firedMilestones = {};
let _perfectDayFired = false;

function fireConfetti(x, y, count = 60) {
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const particles = [];
  const colors = ['#7fb685','#e8a87c','#89b4c9','#c49ac4','#e07b7b','#f0c96e','#b5c987'];
  const cx = x || window.innerWidth / 2;
  const cy = y || window.innerHeight * 0.35;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 8 + 3;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6,
      w: Math.random() * 6 + 3, h: Math.random() * 4 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * 360,
      rotV: (Math.random() - 0.5) * 12,
      life: 1, decay: 0.008 + Math.random() * 0.01,
    });
  }
  let frame = 0;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of particles) {
      if (p.life <= 0) continue;
      alive = true;
      p.x += p.vx; p.vy += 0.2; p.y += p.vy;
      p.vx *= 0.99; p.rot += p.rotV;
      p.life -= p.decay;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive) requestAnimationFrame(animate);
    else canvas.remove();
  }
  animate();
}

function checkStreakMilestones() {
  const today = todayStr();
  const firedKey = `ritual_milestones_${today}`;
  const fired = JSON.parse(localStorage.getItem(firedKey) || '[]');
  state.habits.forEach(h => {
    const s = calcStreak(h.id);
    const nextM = _milestones.find(m => s >= m && !fired.includes(`${h.id}_${m}`));
    if (nextM) {
      fired.push(`${h.id}_${nextM}`);
      setTimeout(() => fireConfetti(null, null, 40 + nextM), 300);
    }
  });
  localStorage.setItem(firedKey, JSON.stringify(fired));
}

function checkPerfectDay() {
  if (_perfectDayFired) return;
  const total = state.habits.filter(h => isActiveToday(h.id) && !isRestDay(h.id)).length;
  if (total === 0) return;
  const done = state.habits.filter(h => isHabitComplete(h)).length;
  if (done >= total) {
    _perfectDayFired = true;
    setTimeout(() => openDayClose(), 600);
  }
}

// ─── DAY CLOSE CEREMONY ───────────────────────────────────────
const _dayCloseQuotes = [
  "Small disciplines repeated with consistency every day lead to great achievements gained slowly over time.",
  "We are what we repeatedly do. Excellence, then, is not an act but a habit.",
  "The secret of your future is hidden in your daily routine.",
  "Motivation gets you going, but discipline keeps you growing.",
  "Success is the sum of small efforts, repeated day in and day out.",
  "Each day is a small life. Live it fully.",
  "You don't rise to the level of your goals — you fall to the level of your systems.",
  "The chains of habit are too light to be felt until they are too heavy to be broken.",
];

function openDayClose() {
  const today = new Date();
  const dateLabel = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const activeHabits = state.habits.filter(h => isActiveToday(h.id) && !isRestDay(h.id));
  const doneHabits   = activeHabits.filter(h => isHabitComplete(h));
  const longestStreak = Math.max(0, ...state.habits.map(h => calcStreak(h.id)));
  const pct = activeHabits.length > 0 ? Math.round((doneHabits.length / activeHabits.length) * 100) : 100;

  $('dayclose-date').textContent = dateLabel;
  $('dayclose-stats').innerHTML = [
    { num: doneHabits.length, lbl: 'Habits done' },
    { num: longestStreak + 'd', lbl: 'Best streak' },
    { num: pct + '%', lbl: 'Score' },
  ].map(s => `<div class="dayclose-stat"><div class="dayclose-stat-num">${s.num}</div><div class="dayclose-stat-lbl">${s.lbl}</div></div>`).join('');

  $('dayclose-chips').innerHTML = doneHabits
    .map((h, i) => `<span class="dayclose-chip" style="animation-delay:${i * 0.07}s">${escHtml(h.icon)} ${escHtml(h.name)}</span>`)
    .join('');

  $('dayclose-quote').textContent = '\u201c' + _dayCloseQuotes[today.getDate() % _dayCloseQuotes.length] + '\u201d';

  _spawnDayCloseParticles();
  openModal('modal-dayclose');
  fireConfetti(null, null, 90);
}

function closeDayClose() {
  closeModal('modal-dayclose');
  _stopDayCloseParticles();
}

let _dcParticleTimer = null;
const _dcColors = ['#7fb685','#f0c96e','#89b4c9','#c49ac4','#e8a87c','#b5c987','#e07b7b'];

function _spawnDayCloseParticles() {
  _stopDayCloseParticles();
  const container = $('dayclose-particles');
  if (!container) return;
  container.innerHTML = '';
  function spawn() {
    const el = document.createElement('div');
    el.className = 'dayclose-particle';
    el.style.cssText = [
      `left:${Math.random() * 100}%`,
      `background:${_dcColors[Math.floor(Math.random() * _dcColors.length)]}`,
      `animation-duration:${1.6 + Math.random() * 1.8}s`,
      `animation-delay:${Math.random() * 0.8}s`,
      `width:${4 + Math.random() * 5}px`,
      `height:${3 + Math.random() * 3}px`,
    ].join(';');
    container.appendChild(el);
    if (container.children.length > 28) container.firstElementChild?.remove();
  }
  for (let i = 0; i < 20; i++) spawn();
  _dcParticleTimer = setInterval(spawn, 280);
}

function _stopDayCloseParticles() {
  if (_dcParticleTimer) { clearInterval(_dcParticleTimer); _dcParticleTimer = null; }
}

// ─── PULL-TO-REFRESH ───────────────────────────────────────────
const _ptr = { pulling: false, startY: 0, pullDist: 0, threshold: 80, refreshing: false };

function ptrInit() {
  document.addEventListener('touchstart', ptrTouchStart, { passive: true });
  document.addEventListener('touchmove', ptrTouchMove, { passive: false });
  document.addEventListener('touchend', ptrTouchEnd, { passive: true });
}

function ptrTouchStart(e) {
  const scrollEl = document.scrollingElement || document.documentElement;
  if (scrollEl.scrollTop !== 0 || _ptr.refreshing) return;
  _ptr.pulling = true;
  _ptr.startY = e.touches[0].clientY;
  _ptr.pullDist = 0;
}

function ptrTouchMove(e) {
  if (!_ptr.pulling) return;
  const y = e.touches[0].clientY;
  let dist = y - _ptr.startY;
  if (dist < 0) { _ptr.pulling = false; ptrReset(); return; }
  if (dist > 50) dist = 50 + (dist - 50) * 0.45;
  _ptr.pullDist = dist;
  const pct = Math.min(dist / _ptr.threshold, 1);
  const overlay = $('ptr-overlay');
  const ring = $('ptr-ring-fill');
  if (overlay) {
    overlay.classList.remove('ptr-hidden');
    overlay.classList.add('ptr-visible');
    overlay.style.transform = `translateY(${dist}px)`;
  }
  if (ring) {
    const circ = 125.66;
    ring.style.strokeDashoffset = String(circ * (1 - pct));
  }
  const label = $('ptr-label');
  if (label) label.textContent = pct >= 1 ? 'Release to refresh' : 'Pull to refresh';
  if (pct >= 1) e.preventDefault();
}

function ptrTouchEnd() {
  if (!_ptr.pulling) return;
  _ptr.pulling = false;
  if (_ptr.pullDist >= _ptr.threshold) ptrRefresh();
  else ptrReset();
}

async function ptrRefresh() {
  _ptr.refreshing = true;
  const label = $('ptr-label');
  if (label) label.textContent = 'Refreshing…';
  const ring = $('ptr-ring-fill');
  if (ring) { ring.style.strokeDashoffset = '0'; ring.style.transition = 'stroke-dashoffset .3s ease'; }
  const overlay = $('ptr-overlay');
  if (overlay) {
    overlay.style.transform = 'translateY(80px)';
    overlay.classList.add('ptr-refreshing');
  }
  try {
    if (typeof queueDrain === 'function') await queueDrain();
    if (currentUser) await loadAll({ silent: true });
    renderView();
    showToast('Refreshed ✓');
  } catch (_) {
    showToast('Refresh failed');
  }
  setTimeout(ptrReset, 500);
}

function ptrReset() {
  _ptr.refreshing = false;
  const overlay = $('ptr-overlay');
  const ring = $('ptr-ring-fill');
  const label = $('ptr-label');
  if (overlay) {
    overlay.style.transform = '';
    overlay.classList.remove('ptr-visible', 'ptr-refreshing');
    overlay.classList.add('ptr-hidden');
  }
  if (ring) {
    ring.style.strokeDashoffset = '125.66';
    ring.style.transition = 'stroke-dashoffset .35s cubic-bezier(.34,1.56,.64,1)';
  }
  if (label) label.textContent = 'Pull to refresh';
}

// ─── SHAREABLE STREAK CARD ─────────────────────────────────────
async function generateStreakCard() {
  const w = 600, h = 400, dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const isDark = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#1a1a14';
  const bg1 = isDark ? '#2a2820' : '#f5f2eb';
  const bg2 = isDark ? '#1a1a14' : '#e8e4d9';
  const text = isDark ? '#e8e4d9' : '#2a2820';
  const muted = isDark ? '#9c9880' : '#6b6550';
  const accent = '#7fb685';
  const ringTrack = isDark ? '#2a2a22' : '#e0dbd0';

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, bg1);
  grad.addColorStop(1, bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const fontMono = 'DM Mono';
  const fontDisplay = 'Cormorant Garamond';

  await document.fonts.ready;

  ctx.fillStyle = accent;
  ctx.font = `600 14px "${fontMono}", monospace`;
  ctx.fillText('RITUAL', 40, 50);

  const best = calcBestStreak();
  ctx.fillStyle = text;
  ctx.font = `500 72px "${fontDisplay}", serif`;
  ctx.fillText(String(best), 40, 175);
  ctx.font = `400 14px "${fontMono}", monospace`;
  ctx.fillStyle = muted;
  ctx.fillText('day streak', 40, 205);

  const total = state.habits.length;
  const done = Object.values(state.todayLogs).filter(v => v > 0).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const cx = 460, cy = 130, r = 75;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.strokeStyle = ringTrack;
  ctx.lineWidth = 8;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (pct / 100) * 2 * Math.PI);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.fillStyle = text;
  ctx.font = `500 32px "${fontDisplay}", serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`${pct}%`, cx, cy + 6);
  ctx.textAlign = 'left';
  ctx.font = `400 12px "${fontMono}", monospace`;
  ctx.fillStyle = muted;
  ctx.textAlign = 'center';
  ctx.fillText('today', cx, cy + 30);
  ctx.textAlign = 'left';

  const statY = 290;
  const stats = [
    { label: 'Habits', value: String(total) },
    { label: 'Done', value: String(Object.values(state.todayLogs).filter(v => v > 0).length) },
    { label: 'Perfect Days', value: String(state.yearLogs ? new Set(state.yearLogs.filter(l => l.value > 0).map(l => l.date)).size : 0) },
  ];
  const statW = 160;
  stats.forEach((s, i) => {
    const x = 40 + i * statW;
    ctx.fillStyle = text;
    ctx.font = `500 28px "${fontDisplay}", serif`;
    ctx.fillText(s.value, x, statY);
    ctx.fillStyle = muted;
    ctx.font = `400 11px "${fontMono}", monospace`;
    ctx.fillText(s.label, x, statY + 22);
  });

  ctx.fillStyle = muted;
  ctx.font = `400 10px "${fontMono}", monospace`;
  ctx.textAlign = 'left';
  ctx.fillText(new Date().toISOString().slice(0, 10), 40, 380);

  return canvas;
}

function calcBestStreak() {
  if (!state.habits.length) return 0;
  let best = 0;
  state.habits.forEach(h => {
    const logs = state.yearLogs ? state.yearLogs.filter(l => l.habit_id === h.id && l.value > 0).map(l => l.date) : [];
    if (!logs.length) return;
    const unique = [...new Set(logs)].sort();
    let streak = 1;
    for (let i = 1; i < unique.length; i++) {
      const d1 = new Date(unique[i - 1]), d2 = new Date(unique[i]);
      const diff = (d2 - d1) / 86400000;
      if (diff === 1) streak++;
      else { if (streak > best) best = streak; streak = 1; }
    }
    if (streak > best) best = streak;
  });
  return best;
}

async function shareStreakCard() {
  try {
    const canvas = await generateStreakCard();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) { showToast('Failed to generate card'); return; }
    const file = new File([blob], `ritual-streak-${todayStr()}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: 'My Ritual Streak', text: 'Check out my habit streak!', files: [file] });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Card downloaded ✓');
    }
  } catch (e) {
    if (e.name !== 'AbortError') showToast('Share failed');
  }
}

// ═══════════════════════════════════════════════════════════════
//  GOAL-BASED TARGETS
// ═══════════════════════════════════════════════════════════════

function calcGoalProgress(habitId) {
  const goal = state.habitGoals[habitId];
  if (!goal) return null;
  const logs = state.yearLogs.filter(l => l.habit_id === habitId && l.date >= goal.start_date && l.date <= todayStr());
  const total = logs.reduce((s, l) => s + l.value, 0);
  const pct = Math.min(100, Math.round((total / goal.target_value) * 100));
  return { current: total, target: goal.target_value, pct, unit: goal.unit, label: goal.label, start_date: goal.start_date, end_date: goal.end_date, habitId };
}

async function saveGoal(habitId, goalData) {
  state.habitGoals[habitId] = goalData;
  lsSet('habit_goals', state.habitGoals);
  try { await setUserData('habit_goals', state.habitGoals); } catch (_) {}
}

async function deleteGoal(habitId) {
  delete state.habitGoals[habitId];
  lsSet('habit_goals', state.habitGoals);
  try { await setUserData('habit_goals', state.habitGoals); } catch (_) {}
}

function openGoalModal(habitId) {
  state.editingGoalHabitId = habitId;
  const goal = state.habitGoals[habitId];
  const h = state.habits.find(x => x.id === habitId);
  $('modal-goal-title').textContent = `Goal for ${h ? h.name : 'habit'}`;
  $('goal-target-input').value = goal?.target_value || '';
  $('goal-unit-input').value = goal?.unit || (h ? h.unit : '');
  $('goal-label-input').value = goal?.label || '';
  $('goal-end-date-input').value = goal?.end_date || '';
  $('goal-start-date-input').value = goal?.start_date || '';
  const delBtn = $('goal-delete-btn');
  if (delBtn) delBtn.style.display = goal ? '' : 'none';
  openModal('modal-goal');
}

async function handleSaveGoal() {
  const hid = state.editingGoalHabitId;
  if (!hid) { showToast('No habit selected'); return; }
  const target_value = parseFloat($('goal-target-input').value);
  if (!target_value || target_value <= 0) { showToast('Enter a target value'); return; }
  const goal = {
    target_value,
    unit: $('goal-unit-input').value.trim(),
    label: $('goal-label-input').value.trim(),
    end_date: $('goal-end-date-input').value,
    start_date: $('goal-start-date-input').value || todayStr(),
  };
  if (!goal.end_date) { showToast('Select a target date'); return; }
  await saveGoal(hid, goal);
  closeModal('modal-goal');
  renderView();
  showToast(goal.label || 'Goal set ✓');
}

async function handleDeleteGoal() {
  const hid = state.editingGoalHabitId;
  if (!hid) return;
  if (!confirm('Delete this goal?')) return;
  await deleteGoal(hid);
  closeModal('modal-goal');
  renderView();
  showToast('Goal deleted');
}

function renderGoalProgress() {
  const list = $('goals-progress-list');
  if (!list) return;
  const goals = state.habits.map(h => calcGoalProgress(h.id)).filter(Boolean);
  if (goals.length === 0) {
    list.innerHTML = '<div class="goal-empty">No goals set yet.</div>';
    return;
  }
  list.innerHTML = goals.map(g => {
    const color = state.habits.find(h => h.id === g.habitId)?.color || 'var(--accent)';
    const daysLeft = Math.max(0, Math.ceil((new Date(g.end_date) - new Date()) / 86400000));
    return `<div class="goal-card" style="border-color:${color}">
      <div class="goal-card-header">
        <span class="goal-card-label">${escHtml(g.label || 'Goal')}</span>
        <span class="goal-card-dates">${g.current} / ${g.target} ${g.unit}</span>
      </div>
      <div class="goal-progress-wrap">
        <div class="goal-progress-row">
          <span class="goal-progress-label">${daysLeft > 0 ? daysLeft + 'd left' : 'Due'}</span>
          <div class="goal-progress-bar-wrap">
            <div class="goal-progress-bar-fill" style="width:${g.pct}%;background:${color}"></div>
          </div>
          <span class="goal-progress-pct">${g.pct}%</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
//  TIME CAPSULE MESSAGES
// ═══════════════════════════════════════════════════════════════

async function saveCapsule(habitId, message) {
  if (!message) {
    delete state.timeCapsules[habitId];
  } else {
    state.timeCapsules[habitId] = {
      message,
      created_at: (state.timeCapsules[habitId]?.created_at) || todayStr(),
      last_shown_milestone: state.timeCapsules[habitId]?.last_shown_milestone || 0,
    };
  }
  lsSet('time_capsules', state.timeCapsules);
  try { await setUserData('time_capsules', state.timeCapsules); } catch (_) {}
}

function checkTimeCapsules() {
  const today = todayStr();
  const capsules = [];
  state.habits.forEach(h => {
    const capsule = state.timeCapsules[h.id];
    if (!capsule || !capsule.message) return;
    const created = new Date(capsule.created_at);
    const daysSince = Math.floor((new Date(today) - created) / 86400000);
    const milestones = [30, 90, 365];
    const nextMilestone = milestones.find(m => daysSince >= m && capsule.last_shown_milestone < m);
    if (nextMilestone) {
      capsules.push({ habit: h, capsule, milestone: nextMilestone });
    }
  });
  return capsules;
}

function renderTimeCapsules() {
  const area = $('time-capsule-area');
  if (!area) return;
  const capsules = checkTimeCapsules();
  if (capsules.length === 0) { area.innerHTML = ''; return; }
  area.innerHTML = capsules.map(c => `
    <div class="time-capsule-card" style="--i:0">
      <div class="time-capsule-header">
        <span class="time-capsule-icon">📜</span>
        <span class="time-capsule-title">A message from your past self</span>
        <span class="time-capsule-milestone">Day ${c.milestone}</span>
      </div>
      <div class="time-capsule-message">"${escHtml(c.capsule.message)}"</div>
      <div style="font-size:0.65rem;color:var(--text-faint);margin-top:0.35rem;text-align:right">
        — ${escHtml(c.habit.name)}, started ${formatDate(c.capsule.created_at)}
      </div>
    </div>
  `).join('');
  // Mark as shown
  capsules.forEach(c => {
    state.timeCapsules[c.habit.id].last_shown_milestone = c.milestone;
  });
  // Persist updates
  if (capsules.length > 0) {
    lsSet('time_capsules', state.timeCapsules);
    setTimeout(() => setUserData('time_capsules', state.timeCapsules).catch(() => {}), 500);
  }
}

// ═══════════════════════════════════════════════════════════════
//  MORNING / EVENING INTENTION SETTING
// ═══════════════════════════════════════════════════════════════

async function saveIntention(date, type, value) {
  if (!state.intentions[date]) state.intentions[date] = { morning: '', evening: '', evening_answered: false };
  if (type === 'morning') state.intentions[date].morning = value;
  else if (type === 'evening') { state.intentions[date].evening = value; state.intentions[date].evening_answered = true; }
  lsSet('intentions', state.intentions);
  try { await setUserData('intentions', state.intentions); } catch (_) {}
}

function renderIntention() {
  const area = $('intention-area');
  if (!area) return;
  const today = todayStr();
  const hour = new Date().getHours();
  const intention = state.intentions[today];
  const isMorning = hour < 12;
  const isEvening = hour >= 17;

  // Morning: prompt to set intention
  if (isMorning && (!intention || !intention.morning)) {
    area.innerHTML = `
      <div class="intention-prompt">
        <div class="intention-prompt-label">☀ Morning</div>
        <div class="intention-prompt-text">What's your one intention for today?</div>
        <div class="intention-input-wrap">
          <input type="text" class="intention-input" id="intention-morning-input" placeholder="e.g. Be present, finish the report..." maxlength="120" />
          <button class="intention-save-btn" id="intention-save-btn">Set</button>
        </div>
      </div>`;
    setTimeout(() => {
      const input = $('intention-morning-input');
      const btn = $('intention-save-btn');
      if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') btn?.click(); });
      if (btn) btn.addEventListener('click', async () => {
        const val = input.value.trim();
        if (!val) { showToast('Enter an intention'); return; }
        await saveIntention(today, 'morning', val);
        renderIntention();
        showToast('Intention set ✓');
      });
    }, 50);
    return;
  }

  // Morning with intention set: show it
  if (isMorning && intention?.morning) {
    area.innerHTML = `
      <div class="intention-prompt">
        <div class="intention-prompt-label">☀ Today's Intention</div>
        <div class="intention-prompt-text">"${escHtml(intention.morning)}"</div>
        <div class="intention-done">☀ Set this morning</div>
      </div>`;
    return;
  }

  // Evening: show reflection
  if (isEvening && intention?.morning && !intention?.evening_answered) {
    area.innerHTML = `
      <div class="intention-reflection">
        <div class="intention-reflection-label">🌙 Evening Reflection</div>
        <div class="intention-reflection-question">Did you live it?</div>
        <div class="intention-reflection-morning">"${escHtml(intention.morning)}"</div>
        <div class="intention-reflection-btns">
          <button class="intention-reflection-btn lived" id="intention-lived-yes">Yes, I did 🌿</button>
          <button class="intention-reflection-btn" id="intention-lived-partly">Partly 🌘</button>
          <button class="intention-reflection-btn" id="intention-lived-no">Not today 🌑</button>
        </div>
      </div>`;
    setTimeout(() => {
      ['lived-yes', 'lived-partly', 'lived-no'].forEach(id => {
        const btn = $(`intention-${id}`);
        if (btn) btn.addEventListener('click', async () => {
          await saveIntention(today, 'evening', id.replace('lived-', ''));
          renderIntention();
        });
      });
    }, 50);
    return;
  }

  // Evening answered or no morning intention
  if (isEvening && intention?.evening_answered) {
    const emoji = intention.evening === 'yes' ? '🌿' : intention.evening === 'partly' ? '🌘' : '🌑';
    area.innerHTML = `
      <div class="intention-prompt">
        <div class="intention-prompt-label">🌙 Evening</div>
        <div class="intention-prompt-text">${emoji} "${escHtml(intention.morning)}"</div>
        <div class="intention-done">Reflection recorded</div>
      </div>`;
    return;
  }

  area.innerHTML = '';
}

// ═══════════════════════════════════════════════════════════════
//  STREAK ARCHAEOLOGY (EULOGY)
// ═══════════════════════════════════════════════════════════════

function calcLongestStreak(habitId) {
  const habit = state.habits.find(h => h.id === habitId);
  if (!habit) return null;
  const logs = state.yearLogs
    .filter(l => l.habit_id === habitId && l.value > 0)
    .reduce((m, l) => { m[l.date] = l.value; return m; }, {});
  const dates = Object.keys(logs).sort();
  if (dates.length === 0) return null;

  let bestStreak = 0, bestStart = '', bestEnd = '';
  let currentStreak = 1, currentStart = dates[0], currentEnd = dates[0];

  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const curr = new Date(dates[i]);
    const diff = (curr - prev) / 86400000;
    if (diff === 1) {
      currentStreak++;
      currentEnd = dates[i];
    } else {
      if (currentStreak > bestStreak) {
        bestStreak = currentStreak;
        bestStart = currentStart;
        bestEnd = currentEnd;
      }
      currentStreak = 1;
      currentStart = dates[i];
      currentEnd = dates[i];
    }
  }
  if (currentStreak > bestStreak) {
    bestStreak = currentStreak;
    bestStart = currentStart;
    bestEnd = currentEnd;
  }

  return { longest: bestStreak, start: bestStart, end: bestEnd };
}

async function updateStreakArchaeology(habitId) {
  const currentStreak = calcStreak(habitId);
  const existing = state.streakArchaeology[habitId];

  if (currentStreak > 0) return; // streak still alive

  // Streak just broke — check if we need to record it
  if (existing && existing.break_date === todayStr()) return;

  const longestData = calcLongestStreak(habitId);
  if (!longestData || longestData.longest < 1) return;

  // Find the break reason
  const breakLog = state.yearLogs.find(l =>
    l.habit_id === habitId && l.date > longestData.end &&
    l.value === 0 && l.note
  );

  state.streakArchaeology[habitId] = {
    longest_streak: Math.max(existing?.longest_streak || 0, longestData.longest),
    longest_start: existing?.longest_start || longestData.start,
    longest_end: existing?.longest_end || longestData.end,
    break_date: todayStr(),
    break_reason: breakLog?.note || null,
    shown: false,
  };

  lsSet('streak_archaeology', state.streakArchaeology);
  try { await setUserData('streak_archaeology', state.streakArchaeology); } catch (_) {}
}

function renderStreakEulogy() {
  const area = $('streak-eulogy-area');
  if (!area) return;

  const today = todayStr();
  const eulogies = [];

  state.habits.forEach(h => {
    const arch = state.streakArchaeology[h.id];
    if (!arch || arch.shown || arch.break_date !== today) return;
    eulogies.push({ habit: h, arch });
  });

  if (eulogies.length === 0) { area.innerHTML = ''; return; }

  area.innerHTML = eulogies.map(e => {
    const reasonText = e.arch.break_reason ? `Reason: ${e.arch.break_reason}` : '';
    return `<div class="streak-eulogy" style="--i:0">
      <div class="eulogy-header">
        <span class="eulogy-icon">🕯</span>
        <span class="eulogy-title">Streak ended — ${escHtml(e.habit.name)}</span>
      </div>
      <div class="eulogy-body">
        <div class="eulogy-stat-row">
          <span class="eulogy-stat-label">Longest run</span>
          <span class="eulogy-stat-value">${e.arch.longest_streak} days</span>
        </div>
        <div class="eulogy-stat-row">
          <span class="eulogy-stat-label">From → To</span>
          <span class="eulogy-stat-value">${formatDate(e.arch.longest_start)} → ${formatDate(e.arch.longest_end)}</span>
        </div>
        <div class="eulogy-stat-row">
          <span class="eulogy-stat-label">Broken on</span>
          <span class="eulogy-stat-value">${formatDate(e.arch.break_date)}</span>
        </div>
        ${reasonText ? `<div class="eulogy-stat-row"><span class="eulogy-stat-label">Why</span><span class="eulogy-stat-value">${reasonText}</span></div>` : ''}
      </div>
      <button class="eulogy-dismiss" onclick="dismissEulogy('${e.habit.id}')">Acknowledge</button>
    </div>`;
  }).join('');
}

function dismissEulogy(habitId) {
  if (state.streakArchaeology[habitId]) {
    state.streakArchaeology[habitId].shown = true;
    lsSet('streak_archaeology', state.streakArchaeology);
    setUserData('streak_archaeology', state.streakArchaeology).catch(() => {});
  }
  renderStreakEulogy();
}

// ═══════════════════════════════════════════════════════════════
//  HABIT CORRELATION MAP
// ═══════════════════════════════════════════════════════════════

function computeCorrelations() {
  const habits = state.habits;
  if (habits.length < 2) return [];

  const results = [];

  for (let i = 0; i < habits.length; i++) {
    for (let j = i + 1; j < habits.length; j++) {
      const a = habits[i], b = habits[j];
      const corr = computePairCorrelation(a, b);
      if (corr) results.push(corr);
    }
  }

  results.sort((x, y) => Math.abs(y.lift) - Math.abs(x.lift));
  return results.slice(0, 10); // top 10
}

function computePairCorrelation(a, b) {
  // Build per-day completion map
  const logMap = {};
  state.yearLogs.forEach(l => {
    if (l.habit_id !== a.id && l.habit_id !== b.id) return;
    if (!logMap[l.date]) logMap[l.date] = {};
    logMap[l.date][l.habit_id] = l.value;
  });

  const aCompleted = aHabit => {
    const h = aHabit.id === a.id ? a : b;
    return h.type === 'checkbox' ? aHabit >= 1 : aHabit >= h.target;
  };

  let both = 0, aDone = 0, bGivenA = 0, bGivenNotA = 0;
  let aDays = 0, notADays = 0;

  Object.entries(logMap).forEach(([date, vals]) => {
    const valA = vals[a.id], valB = vals[b.id];
    if (valA === undefined || valB === undefined) return;

    const doneA = aCompleted({ ...a, id: a.id, value: valA });
    const doneB = aCompleted({ ...b, id: b.id, value: valB });

    if (doneA && doneB) both++;
    if (doneA) { aDays++; if (doneB) bGivenA++; }
    if (!doneA) { notADays++; if (doneB) bGivenNotA++; }
  });

  const total = aDays + notADays;
  if (total < 10) return null; // minimum data

  const pctBgivenA = aDays > 0 ? (bGivenA / aDays) * 100 : 0;
  const pctBgivenNotA = notADays > 0 ? (bGivenNotA / notADays) * 100 : 0;
  const lift = pctBgivenA - pctBgivenNotA;

  if (Math.abs(lift) < 10) return null; // significant enough?

  return {
    a: { id: a.id, name: a.name, icon: a.icon, color: a.color },
    b: { id: b.id, name: b.name, icon: b.icon, color: b.color },
    pctBgivenA: Math.round(pctBgivenA),
    pctBgivenNotA: Math.round(pctBgivenNotA),
    lift: Math.round(lift * 10) / 10,
    both,
    aDays,
    notADays,
  };
}

function renderCorrelationsView() {
  const list = $('correlations-list');
  if (!list) return;
  renderCorrelationsInner(list);
}

function renderCorrelationsInner(container) {
  const correlations = computeCorrelations();
  if (correlations.length === 0) {
    container.innerHTML = '<div class="correlation-empty">Not enough data yet. Keep logging to discover patterns.</div>';
    return;
  }
  container.innerHTML = correlations.map(c => {
    const direction = c.lift > 0 ? 'positive' : 'negative';
    const verb = c.lift > 0 ? 'do' : 'skip';
    const result = c.lift > 0 ? `${c.pctBgivenA}%` : `only ${c.pctBgivenNotA}%`;
    return `<div class="correlation-card">
      <div class="correlation-header">
        <span style="color:${c.a.color}">${escHtml(c.a.icon)}</span>
        <span class="correlation-habits">${escHtml(c.a.name)}</span>
        <span class="correlation-arrow">↔</span>
        <span style="color:${c.b.color}">${escHtml(c.b.icon)}</span>
        <span class="correlation-habits">${escHtml(c.b.name)}</span>
      </div>
      <div class="correlation-stat">
        On days you <strong>${verb}</strong> ${escHtml(c.a.name)}, you do ${escHtml(c.b.name)} <strong>${c.pctBgivenA}%</strong> of the time.
        On days you don't, ${result}.
      </div>
      <span class="correlation-lift ${direction}">${c.lift > 0 ? '+' : ''}${c.lift}% correlation</span>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
//  WITNESS MODE
// ═══════════════════════════════════════════════════════════════

function getWitnessStorage() {
  try { return JSON.parse(localStorage.getItem('ritual_witness_notifs') || '[]'); } catch { return []; }
}
function setWitnessStorage(n) {
  localStorage.setItem('ritual_witness_notifs', JSON.stringify(n));
}

function updateBellDot() {
  const dot = $('bell-dot');
  if (!dot) return;
  const hasUnread = state.witnessNotifs.length > 0;
  dot.classList.toggle('hidden', !hasUnread);
}

function addWitnessNotification(payload) {
  const n = {
    id: Date.now().toString(),
    from_name: payload.from_name || 'Someone',
    habit_name: payload.habit_name || 'a habit',
    streak: payload.streak || 0,
    ts: Date.now(),
  };
  state.witnessNotifs.unshift(n);
  if (state.witnessNotifs.length > 50) state.witnessNotifs = state.witnessNotifs.slice(0, 50);
  setWitnessStorage(state.witnessNotifs);
  updateBellDot();
  if ($('notif-list')) renderWitnessNotifications();
  showToast(`🕯 ${n.from_name} is about to skip — ${n.habit_name}`);
}

function dismissWitnessNotif(id) {
  state.witnessNotifs = state.witnessNotifs.filter(n => n.id !== id);
  setWitnessStorage(state.witnessNotifs);
  updateBellDot();
  renderWitnessNotifications();
}

function clearWitnessNotifs() {
  state.witnessNotifs = [];
  setWitnessStorage(state.witnessNotifs);
  updateBellDot();
  renderWitnessNotifications();
}

function renderWitnessNotifications() {
  const list = $('notif-list');
  if (!list) return;
  if (state.witnessNotifs.length === 0) {
    list.innerHTML = '<div class="notif-empty">No witness notifications yet</div>';
    return;
  }
  list.innerHTML = state.witnessNotifs.map(n => {
    const time = new Date(n.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<div class="notif-item">
      <span class="notif-dot" style="background:var(--amber)"></span>
      <div class="notif-item-body">
        <div class="notif-item-title">🕯 ${escHtml(n.from_name)} is about to skip — ${escHtml(n.habit_name)}</div>
        <div class="notif-item-sub">${n.streak > 0 ? 'On a ' + n.streak + '-day streak' : ''}</div>
        <div class="notif-item-time">${time}</div>
      </div>
      <button class="notif-dismiss-btn" onclick="dismissWitnessNotif('${n.id}')" title="Dismiss">✕</button>
    </div>`;
  }).join('');
}

async function saveWitnessSettings() {
  try { await setUserData('witness_settings', state.witnessSettings); } catch (_) {}
}

function renderWitnessView() {
  const wrap = $('witness-content');
  if (!wrap) return;
  const ws = state.witnessSettings;
  let html = '';

  // Mode toggle
  html += `<div class="witness-card">
    <div class="witness-toggle-row">
      <div>
        <div class="witness-toggle-label">Witness Mode</div>
        <div class="witness-toggle-sub">When ON, your witness will know when you're about to skip</div>
      </div>
      <button class="widget-toggle-btn ${ws.mode_on ? '' : 'off'}" id="witness-mode-view-btn">${ws.mode_on ? 'ON' : 'OFF'}</button>
    </div>
  </div>`;

  // My Witness
  html += `<div class="witness-card">
    <div class="witness-card-header">
      <span class="witness-card-title">👁 My Witness</span>
    </div>`;
  if (ws.my_witness.user_id) {
    const statusLabel = ws.my_witness.status === 'accepted' ? 'Accepted' : ws.my_witness.status === 'pending' ? 'Pending...' : ws.my_witness.status === 'declined' ? 'Declined' : 'None';
    const statusClass = ws.my_witness.status === 'accepted' ? 'accepted' : ws.my_witness.status === 'pending' ? 'pending' : 'declined';
    html += `<div class="witness-card-body">
      <div class="witness-row">
        <span class="witness-label">Name</span>
        <span class="witness-value">${escHtml(ws.my_witness.name)}</span>
      </div>
      <div class="witness-row">
        <span class="witness-label">Email</span>
        <span class="witness-value">${escHtml(ws.my_witness.email)}</span>
      </div>
      <div class="witness-row">
        <span class="witness-label">Status</span>
        <span class="witness-status ${statusClass}">${statusLabel}</span>
      </div>`;
    if (ws.my_witness.status === 'accepted') {
      html += `<div style="margin-top:0.5rem"><button class="btn-ghost small" onclick="handleRemoveWitness()" style="color:var(--red)">Remove witness</button></div>`;
    }
    html += `</div>`;
  } else {
    html += `<div class="witness-card-body">
      <div class="witness-row">
        <span class="witness-label">Status</span>
        <span class="witness-value" style="color:var(--text-faint)">No witness set</span>
      </div>
    </div>`;
  }
  // Email search
  html += `<div style="margin-top:0.5rem;display:flex;gap:0.5rem">
    <input type="email" class="witness-email-input" id="witness-email-input" placeholder="Enter email to find your witness..." />
    <button class="btn-primary small" id="witness-send-request-btn">Send Request</button>
  </div>`;
  html += `</div>`;

  // Incoming Requests
  const requests = ws.witness_requests || [];
  html += `<div class="witness-card">
    <div class="witness-card-header">
      <span class="witness-card-title">📨 Incoming Requests</span>
    </div>
    <div class="witness-card-body">`;
  if (requests.length === 0) {
    html += `<div class="witness-empty">No incoming requests</div>`;
  } else {
    requests.forEach(r => {
      html += `<div class="witness-request-item">
        <div class="witness-request-info">
          <div class="witness-request-name">${escHtml(r.from_name)}</div>
          <div class="witness-request-email">${escHtml(r.from_email)}</div>
        </div>
        <div class="witness-request-actions">
          <button class="witness-accept-btn" onclick="handleAcceptWitness('${r.id}')">Accept</button>
          <button class="witness-decline-btn" onclick="handleDeclineWitness('${r.id}')">Decline</button>
        </div>
      </div>`;
    });
  }
  html += `</div></div>`;

  // People I Witness
  const iWitness = ws.i_witness || [];
  html += `<div class="witness-card">
    <div class="witness-card-header">
      <span class="witness-card-title">👤 People I Witness</span>
    </div>
    <div class="witness-card-body">`;
  if (iWitness.length === 0) {
    html += `<div class="witness-empty">No one yet. When someone sets you as their witness and you accept, they'll appear here.</div>`;
  } else {
    iWitness.forEach(p => {
      html += `<div class="witness-i-item">
        <span class="witness-i-name">${escHtml(p.name)}</span>
        <span class="witness-i-email">${escHtml(p.email)}</span>
      </div>`;
    });
  }
  html += `</div></div>`;

  wrap.innerHTML = html;

  // Bind events
  setTimeout(() => {
    const modeBtn = $('witness-mode-view-btn');
    if (modeBtn) modeBtn.addEventListener('click', toggleWitnessMode);
    const sendBtn = $('witness-send-request-btn');
    if (sendBtn) sendBtn.addEventListener('click', handleSendWitnessRequest);
    const emailInput = $('witness-email-input');
    if (emailInput) emailInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleSendWitnessRequest(); });
  }, 50);
}

function toggleWitnessMode() {
  state.witnessSettings.mode_on = !state.witnessSettings.mode_on;
  saveWitnessSettings();
  renderWitnessView();
  // Also update settings section if visible
  const modeBtn = $('witness-mode-btn');
  if (modeBtn) {
    modeBtn.textContent = state.witnessSettings.mode_on ? 'ON' : 'OFF';
    modeBtn.className = state.witnessSettings.mode_on ? 'widget-toggle-btn' : 'widget-toggle-btn off';
  }
  showToast(state.witnessSettings.mode_on ? 'Witness Mode ON' : 'Witness Mode OFF');
}

async function handleSendWitnessRequest() {
  const input = $('witness-email-input');
  if (!input) return;
  const email = input.value.trim();
  if (!email) { showToast('Enter an email'); return; }

  if (email === currentUser?.email) { showToast('Cannot witness yourself'); return; }

  try {
    const user = await lookupUserByEmail(email);
    if (!user) { showToast('User not found — they need a Ritual account'); return; }

    const result = await sendWitnessRequest(
      email,
      currentUser.id,
      state._witnessUserName,
      currentUser.email || ''
    );

    if (result?.success) {
      showToast('Request sent ✓');
      // Reload to reflect new state
      await loadAll({ silent: true });
      renderWitnessView();
    } else {
      showToast(result?.error || 'Failed to send request');
    }
  } catch (e) {
    showToast('Error: ' + (e.message || 'Failed'));
  }
}

async function handleAcceptWitness(requestId) {
  try {
    const result = await acceptWitnessRequest(requestId, currentUser.id);
    if (result?.success) {
      showToast('Request accepted ✓');
      await loadAll({ silent: true });
      renderWitnessView();
      // Broadcast to sender that their request was accepted
      const req = state.witnessSettings.witness_requests?.find(r => r.id === requestId);
      if (req?.from_user_id && typeof broadcastWitnessRequestUpdate === 'function') {
        broadcastWitnessRequestUpdate(req.from_user_id);
      }
    } else {
      showToast(result?.error || 'Failed to accept');
    }
  } catch (e) {
    showToast('Error: ' + (e.message || 'Failed'));
  }
}

async function handleDeclineWitness(requestId) {
  try {
    const result = await declineWitnessRequest(requestId, currentUser.id);
    if (result?.success) {
      showToast('Request declined');
      await loadAll({ silent: true });
      renderWitnessView();
    } else {
      showToast(result?.error || 'Failed to decline');
    }
  } catch (e) {
    showToast('Error: ' + (e.message || 'Failed'));
  }
}

async function handleRemoveWitness() {
  if (!confirm('Remove your witness? They will no longer receive notifications when you skip.')) return;
  try {
    const result = await removeWitness(currentUser.id);
    if (result?.success) {
      showToast('Witness removed');
      await loadAll({ silent: true });
      renderWitnessView();
      const modeBtn = $('witness-mode-btn');
      if (modeBtn) modeBtn.textContent = state.witnessSettings.mode_on ? 'ON' : 'OFF';
    } else {
      showToast(result?.error || 'Failed to remove');
    }
  } catch (e) {
    showToast('Error: ' + (e.message || 'Failed'));
  }
}

function sendSkipWitnessNotification(habitId) {
  const ws = state.witnessSettings;
  if (!ws.mode_on) return;
  if (!ws.my_witness?.user_id || ws.my_witness?.status !== 'accepted') return;
  if (ws.last_notified_date === todayStr()) return; // rate limit: 1/day

  const habit = state.habits.find(h => h.id === habitId);
  if (!habit) return;
  const streak = calcStreak(habitId);

  try {
    broadcastWitnessNotification(ws.my_witness.user_id, {
      from_name: state._witnessUserName,
      habit_name: habit.name,
      streak,
    });
    state.witnessSettings.last_notified_date = todayStr();
    saveWitnessSettings();
  } catch (_) {}
}

function renderWitnessSettingsDetail() {
  const container = $('witness-settings-detail');
  if (!container) return;
  const ws = state.witnessSettings;

  if (ws.my_witness.user_id && ws.my_witness.status === 'accepted') {
    container.innerHTML = `<div style="padding:0.5rem 0">
      <div style="font-size:0.78rem;color:var(--text);margin-bottom:0.25rem">👁 Witnessing: <strong>${escHtml(ws.my_witness.name)}</strong></div>
      <div style="font-size:0.68rem;color:var(--text-faint)">${escHtml(ws.my_witness.email)}</div>
      <button class="btn-icon-sm" style="margin-top:0.35rem;color:var(--red)" onclick="handleRemoveWitness();renderSettings();">Remove</button>
    </div>`;
  } else if (ws.my_witness.user_id && ws.my_witness.status === 'pending') {
    container.innerHTML = `<div style="padding:0.5rem 0;font-size:0.78rem;color:var(--amber)">⏳ Request pending to ${escHtml(ws.my_witness.name)}</div>`;
  } else {
    container.innerHTML = `<div style="padding:0.5rem 0;font-size:0.78rem;color:var(--text-faint)">No witness set. Go to <a href="#" onclick="switchView('witness');return false" style="color:var(--accent)">Witness view</a> to find one.</div>`;
  }
}

// ═══ BIND EVENTS ═════════════════════════════════════════════
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
    state.tasks = [];
    state.todayLogs = {};
    state.yearLogs = [];
    if (typeof clearReminders === 'function') clearReminders();
    if (typeof unsubscribeWitnessBroadcast === 'function') unsubscribeWitnessBroadcast();
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
    const open = $('sidebar').classList.toggle('open');
    $('sidebar-overlay').classList.toggle('visible');
    $('hamburger').setAttribute('aria-expanded', String(open));
  });
  $('sidebar-close')?.addEventListener('click', () => {
    $('sidebar').classList.remove('open');
    $('sidebar-overlay').classList.remove('visible');
    $('hamburger')?.setAttribute('aria-expanded', 'false');
  });
  $('sidebar-overlay')?.addEventListener('click', () => {
    $('sidebar').classList.remove('open');
    $('sidebar-overlay').classList.remove('visible');
    $('hamburger')?.setAttribute('aria-expanded', 'false');
  });

  // Topbar add
  $('topbar-action')?.addEventListener('click', () => {
    if (state.currentView === 'habits') openHabitModal(null);
    else if (state.currentView === 'today') openHabitModal(null);
    else if (state.currentView === 'tasks') openTaskModal(null);
    else switchView('habits');
  });

  // Theme
  $('theme-toggle')?.addEventListener('click', cycleTheme);

  // Desktop refresh button
  $('ptr-desktop-btn')?.addEventListener('click', async () => {
    if (_ptr.refreshing) return;
    if (typeof queueDrain === 'function') await queueDrain();
    if (currentUser) await loadAll({ silent: true });
    renderView();
    showToast('Refreshed ✓');
  });

  // Share streak card
  $('share-card-btn')?.addEventListener('click', shareStreakCard);

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
        await upsertLog(habitId, todayStr(), 0, reason);
        state.todayLogs[habitId] = 0;
        state.pendingSkipHabitId = null;
        _perfectDayFired = false;
        // Send witness notification if enabled
        sendSkipWitnessNotification(habitId);
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
      // Send witness notification if enabled
      sendSkipWitnessNotification(habitId);
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
    lsSet('limitless_widget_on', next);
    try { await setUserData('limitless_widget_on', next); } catch (_) {}
    renderView();
    showToast(next ? 'Limitless widget visible' : 'Limitless widget hidden');
  });

  // Export
  $('settings-export-btn')?.addEventListener('click', exportAllData);

  // Delete all data
  $('settings-delete-all-btn')?.addEventListener('click', async () => {
    if (!confirm('Delete ALL your habits, logs, and tasks? This cannot be undone.')) return;
    if (!confirm('Are you sure? This is permanent.')) return;
    try {
      for (const h of state.habits) {
        const { error } = await _sb.from('habit_logs').delete().eq('user_id', currentUser.id).eq('habit_id', h.id);
        if (error) throw error;
        await _sb.from('habits').delete().eq('id', h.id).eq('user_id', currentUser.id);
      }
      await _sb.from('tasks').delete().eq('user_id', currentUser.id);
      state.habits = [];
      state.tasks = [];
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
    state.tasks = [];
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

  // ══ GOAL EVENTS ═══════════════════════════════════════════════
  $('save-goal-btn')?.addEventListener('click', handleSaveGoal);
  $('goal-delete-btn')?.addEventListener('click', handleDeleteGoal);
  $('goal-target-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') handleSaveGoal(); });
  $('goal-label-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') handleSaveGoal(); });

  // ══ WITNESS / BELL EVENTS ══════════════════════════════════════
  $('bell-btn')?.addEventListener('click', () => {
    const panel = $('notif-panel');
    const overlay = $('notif-panel-overlay');
    if (!panel) return;
    const isOpen = !panel.classList.contains('hidden');
    if (isOpen) {
      panel.classList.add('hidden');
      overlay?.classList.add('hidden');
    } else {
      panel.classList.remove('hidden');
      overlay?.classList.remove('hidden');
      renderWitnessNotifications();
    }
  });
  $('notif-panel-overlay')?.addEventListener('click', () => {
    $('notif-panel')?.classList.add('hidden');
    $('notif-panel-overlay')?.classList.add('hidden');
  });
  $('notif-clear-btn')?.addEventListener('click', clearWitnessNotifs);

  // Witness mode toggle in settings
  $('witness-mode-btn')?.addEventListener('click', () => {
    state.witnessSettings.mode_on = !state.witnessSettings.mode_on;
    saveWitnessSettings();
    const btn = $('witness-mode-btn');
    if (btn) {
      btn.textContent = state.witnessSettings.mode_on ? 'ON' : 'OFF';
      btn.className = state.witnessSettings.mode_on ? 'widget-toggle-btn' : 'widget-toggle-btn off';
    }
    showToast(state.witnessSettings.mode_on ? 'Witness Mode ON' : 'Witness Mode OFF');
  });

  // ══ IMPORT / EXPORT ════════════════════════════════════════════
  $('ritual-export-csv')?.addEventListener('click', exportRitualCSV);
  $('ritual-export-xlsx')?.addEventListener('click', exportRitualXLSX);
  $('ritual-import-btn')?.addEventListener('click', () => $('ritual-import-input')?.click());
  $('ritual-import-input')?.addEventListener('change', handleRitualImport);

  // ══ TASK EVENTS ═══════════════════════════════════════════════
  $('save-task-btn')?.addEventListener('click', handleSaveTask);
  $('task-title-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') handleSaveTask(); });
  $('task-delete-btn')?.addEventListener('click', () => {
    if (state.editingTaskId) handleDeleteTask(state.editingTaskId);
  });

  // Task priority picker
  $$('#task-priority-toggle .type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#task-priority-toggle .type-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Task filter buttons
  $$('.tasks-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.tasksFilter = btn.dataset.tasksFilter;
      $$('.tasks-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTasksView();
    });
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

// ═══════════════════════════════════════════════════════════════
//  IMPORT / EXPORT
// ═══════════════════════════════════════════════════════════════

const RITUAL_EXPORT_COLS = ['id','user_id','name','icon','type','target','unit','time_of_day','color','sort_order','created_at'];
const RITUAL_LOG_COLS = ['id','user_id','habit_id','log_date','value','note'];
const RITUAL_SIG = ['name','icon','type','target','unit'];

function _dl(text, name, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function exportRitualCSV() {
  try {
    const habits = await _fetchAll('habits');
    const logs = await _fetchAll('habit_logs', 'log_date');
    _dl(_csv(habits, RITUAL_EXPORT_COLS), 'ritual_habits.csv', 'text/csv');
    _dl(_csv(logs, RITUAL_LOG_COLS), 'ritual_habit_logs.csv', 'text/csv');
    showToast('Downloaded: ritual_habits.csv + ritual_habit_logs.csv');
  } catch(e) { showToast('Export failed: ' + e.message); }
}

async function exportRitualXLSX() {
  try {
    if (typeof XLSX === 'undefined') { showToast('Loading SheetJS…'); return; }
    const habits = await _fetchAll('habits');
    const logs = await _fetchAll('habit_logs', 'log_date');
    const wb = XLSX.utils.book_new();
    wb.SheetNames.push('Habits');
    wb.Sheets['Habits'] = XLSX.utils.json_to_sheet(habits.map(r => _pick(r, RITUAL_EXPORT_COLS)));
    wb.SheetNames.push('Habit Logs');
    wb.Sheets['Habit Logs'] = XLSX.utils.json_to_sheet(logs.map(r => _pick(r, RITUAL_LOG_COLS)));
    XLSX.writeFile(wb, 'ritual_export.xlsx');
    showToast('Downloaded: ritual_export.xlsx');
  } catch(e) { showToast('Export failed: ' + e.message); }
}

async function handleRitualImport(e) {
  const file = e.target?.files?.[0];
  if (!file) return;
  e.target.value = '';
  try {
    const ext = file.name.split('.').pop().toLowerCase();
    let rows;
    if (ext === 'csv') rows = _parseCSV(await file.text());
    else if (ext === 'xlsx') rows = _parseXLSX(await file.arrayBuffer());
    else { showToast('Unsupported file type. Use .csv or .xlsx'); return; }
    if (!rows || !rows.length) { showToast('Empty file'); return; }

    const sig = Object.keys(rows[0]).map(k => k.toLowerCase().trim());
    const isRitual = RITUAL_SIG.some(s => sig.includes(s));
    if (!isRitual) { showToast('Not a valid Ritual export file'); return; }

    const habits = rows.filter(r => RITUAL_SIG.some(s => r[s] !== undefined));
    const logCols = ['habit_id','log_date','value'];
    const logs = rows.filter(r => logCols.some(s => r[s] !== undefined));

    let imported = 0;
    const sb = window.__sb;
    if (!sb || !currentUser) { showToast('Not authenticated'); return; }
    if (habits.length) {
      for (const h of habits) {
        const { id, user_id, created_at, ...rest } = h;
        const row = _normalizeHabit(rest);
        try { await sb.from('habits').insert({ ...row, user_id: currentUser.id }); imported++; } catch(_) {}
      }
    }
    if (logs.length) {
      for (const l of logs) {
        const { id, user_id, created_at, ...rest } = l;
        const row = _normalizeLog(rest);
        try { await sb.from('habit_logs').insert({ ...row, user_id: currentUser.id }); imported++; } catch(_) {}
      }
    }
    showToast(`Imported ${imported} rows`);
    if (imported > 0) { await loadAll(); renderView(); }
  } catch(e) { showToast('Import failed: ' + e.message); }
}

function _csv(data, cols) {
  const esc = v => { const s = v == null ? '' : String(v); return s.includes(',') || s.includes('"') ? '"' + s.replace(/"/g,'""') + '"' : s; };
  return [cols.join(','), ...data.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

function _pick(obj, cols) {
  const r = {};
  cols.forEach(c => { if (obj[c] !== undefined) r[c] = obj[c]; });
  return r;
}
function _normalizeHabit(row) {
  const r = { ...row };
  if (r.target === '' || r.target === undefined || r.target === null) r.target = null;
  else if (typeof r.target === 'string') { const n = parseFloat(r.target); r.target = isNaN(n) ? null : n; }
  if (r.sort_order === '' || r.sort_order === undefined || r.sort_order === null) r.sort_order = null;
  else if (typeof r.sort_order === 'string') { const n = parseFloat(r.sort_order); r.sort_order = isNaN(n) ? null : n; }
  ['time_of_day','color'].forEach(k => {
    if (r[k] === '' || r[k] === undefined) r[k] = null;
  });
  return r;
}
function _normalizeLog(row) {
  const r = { ...row };
  if (r.value === '' || r.value === undefined || r.value === null) r.value = null;
  else if (typeof r.value === 'string') { const n = parseFloat(r.value); r.value = isNaN(n) ? null : n; }
  if (r.note === '' || r.note === undefined) r.note = null;
  return r;
}

function _parseCSV(text) {
  const lines = text.trim().split('\n');
  if (!lines.length) return [];
  const cols = lines[0].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = [];
    let inQ = false, cur = '';
    for (const ch of lines[i]) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    vals.push(cur.trim());
    const row = {};
    cols.forEach((c, idx) => { if (vals[idx] !== undefined) row[c.trim()] = vals[idx]; });
    rows.push(row);
  }
  return rows;
}

function _parseXLSX(buf) {
  const wb = XLSX.read(buf, { type: 'array' });
  const rows = [];
  wb.SheetNames.forEach(sn => {
    const sheet = wb.Sheets[sn];
    if (!sheet) return;
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    data.forEach(r => rows.push(r));
  });
  return rows;
}

async function _fetchAll(table, orderCol = 'created_at') {
  const sb = window.__sb;
  if (!sb || !currentUser) throw new Error('Not authenticated');
  const { data, error } = await sb.from(table).select('*').eq('user_id', currentUser.id).order(orderCol);
  if (error) throw error;
  return data || [];
}

document.addEventListener('DOMContentLoaded', init);
