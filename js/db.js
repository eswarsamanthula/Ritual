// ============================================================
//  RITUAL — DATABASE LAYER
//  Auth reused from Limitless. Habits + logs are new.
// ============================================================

let _sb = null;
let currentUser = null;
let _channels = [];

// ─── INIT ───────────────────────────────────────────────────
function initSupabase() {
  if (SUPABASE_URL.includes('your-project.supabase.co')) return false;
  try {
    _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        storage: localStorage,
        autoRefreshToken: true,
      },
    });
    window.__sb = _sb;
    return true;
  } catch (e) {
    console.warn('Supabase init failed:', e);
    return false;
  }
}
// ─── AUTH — GOOGLE ───────────────────────────────────────────
async function signInWithGoogle() {
  if (!_sb) throw new Error('Supabase not configured');
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await _sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo }
  });
  if (error) throw error;
}

// ─── AUTH — EMAIL SIGN UP ────────────────────────────────────
async function signUpWithEmail(email, password) {
  if (!_sb) throw new Error('Supabase not configured');
  const redirectTo = window.location.origin + window.location.pathname;
  const { data, error } = await _sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: redirectTo }
  });
  if (error) throw error;
  return data;
}

// ─── AUTH — EMAIL SIGN IN ────────────────────────────────────
async function signInWithEmail(email, password) {
  if (!_sb) throw new Error('Supabase not configured');
  const { data, error } = await _sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// ─── AUTH — SIGN OUT ─────────────────────────────────────────
async function signOut() {
  unsubscribeRealtime();
  localStorage.removeItem('limitless_logged_in');
  if (_sb) await _sb.auth.signOut();
  currentUser = null;
}

// ─── AUTH — SESSION ──────────────────────────────────────────
async function getSession() {
  if (!_sb) return null;
  const { data } = await _sb.auth.getSession();
  return data?.session || null;
}

// --- AUTH � FRESH USER (server-side, not from JWT) ----------
async function getFreshUser() {
  if (!_sb) return null;
  const { data } = await _sb.auth.getUser();
  return data?.user || null;
}

// ─── AUTH — LISTEN ───────────────────────────────────────────
function onAuthChange(callback) {
  if (!_sb) return;
  _sb.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    if (session) localStorage.setItem('limitless_logged_in', '1');
    callback(session, event);
  });
}

// ─── AUTH — PASSWORD RESET ───────────────────────────────────
async function sendPasswordReset(email) {
  if (!_sb) throw new Error('Supabase not configured');
  const { error } = await _sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href
  });
  if (error) throw error;
}

// ─── HABITS ──────────────────────────────────────────────────
async function getHabits() {
  if (!_sb || !currentUser) return [];
  const { data, error } = await _sb
    .from('habits')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function saveHabit(habit) {
  if (!_sb || !currentUser) throw new Error('Not authenticated');
  const payload = {
    name: habit.name,
    icon: habit.icon || '◎',
    type: habit.type || 'checkbox',
    target: habit.target || 1,
    unit: habit.unit || '',
    time_of_day: habit.time_of_day || 'any',
    color: habit.color || '#7fb685',
    sort_order: habit.sort_order || 0,
  };
  try {
    if (habit.id) {
      const { error } = await _sb.from('habits')
        .update(payload)
        .eq('id', habit.id)
        .eq('user_id', currentUser.id);
      if (error) throw error;
      return { id: habit.id };
    } else {
      const { data, error } = await _sb.from('habits')
        .insert({ ...payload, user_id: currentUser.id })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    }
  } catch (e) {
    if (!navigator.onLine) { queueAdd('saveHabit', habit); return { id: habit.id || 'pending' }; }
    throw e;
  }
}

async function deleteHabit(id) {
  if (!_sb || !currentUser) throw new Error('Not authenticated');
  try {
    const { error } = await _sb.from('habits')
      .delete()
      .eq('id', id)
      .eq('user_id', currentUser.id);
    if (error) throw error;
  } catch (e) {
    if (!navigator.onLine) { queueAdd('deleteHabit', id); return; }
    throw e;
  }
}

async function updateHabitTime(id, timeOfDay) {
  if (!_sb || !currentUser) throw new Error('Not authenticated');
  try {
    const { error } = await _sb.from('habits')
      .update({ time_of_day: timeOfDay })
      .eq('id', id)
      .eq('user_id', currentUser.id);
    if (error) throw error;
  } catch (e) {
    if (!navigator.onLine) { queueAdd('saveHabit', { id, time_of_day: timeOfDay }); return; }
    throw e;
  }
}

async function reorderHabits(orderedIds) {
  if (!_sb || !currentUser) throw new Error('Not authenticated');
  try {
    await Promise.all(orderedIds.map((id, i) =>
      _sb.from('habits').update({ sort_order: i }).eq('id', id).eq('user_id', currentUser.id)
    ));
  } catch (e) {
    if (!navigator.onLine) return; // silently skip reorder when offline
    throw e;
  }
}

// ─── HABIT LOGS ──────────────────────────────────────────────
// dateStr = 'YYYY-MM-DD'
async function getTodayLogs(dateStr) {
  if (!_sb || !currentUser) return [];
  const { data, error } = await _sb
    .from('habit_logs')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('date', dateStr);
  if (error) throw error;
  return data || [];
}

async function getLogsRange(fromDate, toDate) {
  if (!_sb || !currentUser) return [];
  const { data, error } = await _sb
    .from('habit_logs')
    .select('*')
    .eq('user_id', currentUser.id)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function upsertLog(habitId, dateStr, value, note) {
  if (!_sb || !currentUser) throw new Error('Not authenticated');
  try {
    const { error } = await _sb.from('habit_logs').upsert({
      user_id: currentUser.id,
      habit_id: habitId,
      date: dateStr,
      value: value,
      note: note || null,
      logged_at: new Date().toISOString(),
    }, { onConflict: 'user_id,habit_id,date' });
    if (error) throw error;
  } catch (e) {
    if (!navigator.onLine) { queueAdd('upsertLog', { habitId, dateStr, value, note }); return; }
    throw e;
  }
}

async function deleteLog(habitId, dateStr) {
  if (!_sb || !currentUser) throw new Error('Not authenticated');
  try {
    const { error } = await _sb.from('habit_logs')
      .delete()
      .eq('user_id', currentUser.id)
      .eq('habit_id', habitId)
      .eq('date', dateStr);
    if (error) throw error;
  } catch (e) {
    if (!navigator.onLine) { queueAdd('deleteLog', { habitId, dateStr }); return; }
    throw e;
  }
}

// ─── SEED DEFAULT HABITS ─────────────────────────────────────
async function seedDefaultHabits() {
  if (!_sb || !currentUser) return;
  const existing = await getHabits();
  if (existing.length > 0) return; // already has habits
  for (let i = 0; i < DEFAULT_HABITS.length; i++) {
    await saveHabit({ ...DEFAULT_HABITS[i], sort_order: i });
  }
}

// ─── REALTIME ────────────────────────────────────────────────
function subscribeRealtime(callback) {
  if (!_sb || !currentUser) return;
  const uid = currentUser.id;
  ['habits', 'habit_logs', 'user_data'].forEach(table => {
    const ch = _sb.channel(`ritual-${table}-${uid}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table, filter: `user_id=eq.${uid}` },
        () => callback(table)
      )
      .subscribe();
    _channels.push(ch);
  });
}

function unsubscribeRealtime() {
  _channels.forEach(ch => _sb?.removeChannel(ch));
  _channels = [];
  unsubscribeWitnessBroadcast();
}

// ═══════════════════════════════════════════════════════════════
//  OFFLINE CACHE + WRITE QUEUE
// ═══════════════════════════════════════════════════════════════

const _CACHE_PREFIX = 'ritual_cache_';
const _QUEUE_KEY = 'ritual_write_queue';

function cacheSave(key, data) {
  try { localStorage.setItem(_CACHE_PREFIX + key, JSON.stringify(data)); } catch (_) {}
}
function cacheLoad(key) {
  try { const r = localStorage.getItem(_CACHE_PREFIX + key); return r ? JSON.parse(r) : null; } catch (_) { return null; }
}
function cacheClear() {
  Object.keys(localStorage).filter(k => k.startsWith(_CACHE_PREFIX)).forEach(k => localStorage.removeItem(k));
}

function queueGet() {
  try { return JSON.parse(localStorage.getItem(_QUEUE_KEY) || '[]'); } catch { return []; }
}
function queueSet(q) {
  localStorage.setItem(_QUEUE_KEY, JSON.stringify(q));
}
function queueAdd(action, payload) {
  const q = queueGet(); q.push({ action, payload, ts: Date.now() }); queueSet(q);
}
function queueSize() { return queueGet().length; }

async function queueDrain() {
  const q = queueGet();
  if (!q.length) return;
  const kept = [];
  for (const item of q) {
    try {
      switch (item.action) {
        case 'saveHabit':  await _queueSaveHabit(item.payload); break;
        case 'deleteHabit': await _queueDeleteHabit(item.payload); break;
        case 'upsertLog':  await _queueUpsertLog(item.payload.habitId, item.payload.dateStr, item.payload.value, item.payload.note); break;
        case 'deleteLog':  await _queueDeleteLog(item.payload.habitId, item.payload.dateStr); break;
      }
    } catch (_) { kept.push(item); }
  }
  queueSet(kept);
}

async function _queueSaveHabit(habit) {
  if (!_sb || !currentUser) throw Error('No auth');
  const payload = { name: habit.name, icon: habit.icon || '◎', type: habit.type || 'checkbox', target: habit.target || 1, unit: habit.unit || '', time_of_day: habit.time_of_day || 'any', color: habit.color || '#7fb685', sort_order: habit.sort_order || 0 };
  if (habit.id) {
    const { error } = await _sb.from('habits').update(payload).eq('id', habit.id).eq('user_id', currentUser.id);
    if (error) throw error;
  } else {
    const { data, error } = await _sb.from('habits').insert({ ...payload, user_id: currentUser.id }).select('id').single();
    if (error) throw error;
    return data;
  }
}
async function _queueDeleteHabit(id) {
  if (!_sb || !currentUser) throw Error('No auth');
  const { error } = await _sb.from('habits').delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) throw error;
}
async function _queueUpsertLog(habitId, dateStr, value, note) {
  if (!_sb || !currentUser) throw Error('No auth');
  const { error } = await _sb.from('habit_logs').upsert({ user_id: currentUser.id, habit_id: habitId, date: dateStr, value: value, note: note || null, logged_at: new Date().toISOString() }, { onConflict: 'user_id,habit_id,date' });
  if (error) throw error;
}
async function _queueDeleteLog(habitId, dateStr) {
  if (!_sb || !currentUser) throw Error('No auth');
  const { error } = await _sb.from('habit_logs').delete().eq('user_id', currentUser.id).eq('habit_id', habitId).eq('date', dateStr);
  if (error) throw error;
}

// ─── LOCAL STORAGE HELPERS (for local-only user data) ──────
const LS_PREFIX = 'ritual_';
function lsGet(key, def) {
  try { const r = localStorage.getItem(LS_PREFIX + key); return r ? JSON.parse(r) : def; } catch { return def; }
}
function lsSet(key, val) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch {}
}
function lsRemove(key) {
  try { localStorage.removeItem(LS_PREFIX + key); } catch {}
}

// ─── USER DATA (shared key-value sync with Limitless) ──────
async function loadAllUserData() {
  if (!_sb || !currentUser) return {};
  const { data, error } = await _sb
    .from('user_data')
    .select('key, value')
    .eq('user_id', currentUser.id);
  if (error) throw error;
  const map = {};
  for (const row of data || []) map[row.key] = row.value;
  return map;
}

async function setUserData(key, value) {
  if (!_sb || !currentUser) throw new Error('Not authenticated');
  const { error } = await _sb
    .from('user_data')
    .upsert({ user_id: currentUser.id, key, value }, { onConflict: 'user_id, key' });
  if (error) throw error;
}

async function deleteUserData(key) {
  if (!_sb || !currentUser) throw new Error('Not authenticated');
  const { error } = await _sb
    .from('user_data')
    .delete()
    .eq('user_id', currentUser.id)
    .eq('key', key);
  if (error) throw error;
}

// ─── WITNESS MODE RPC ───────────────────────────────────────
async function lookupUserByEmail(email) {
  if (!_sb) throw new Error('Supabase not configured');
  const { data, error } = await _sb.rpc('get_user_by_email', { search_email: email });
  if (error) throw error;
  return data?.[0] || null;
}

async function sendWitnessRequest(targetEmail, fromUserId, fromName, fromEmail) {
  if (!_sb) throw new Error('Supabase not configured');
  const { data, error } = await _sb.rpc('add_witness_request', {
    target_email: targetEmail,
    from_user_id: fromUserId,
    from_name: fromName,
    from_email: fromEmail,
  });
  if (error) throw error;
  return data;
}

async function acceptWitnessRequest(requestId, userId) {
  if (!_sb) throw new Error('Supabase not configured');
  const { data, error } = await _sb.rpc('accept_witness_request', {
    request_id: requestId,
    accepter_user_id: userId,
  });
  if (error) throw error;
  return data;
}

async function declineWitnessRequest(requestId, userId) {
  if (!_sb) throw new Error('Supabase not configured');
  const { data, error } = await _sb.rpc('decline_witness_request', {
    request_id: requestId,
    accepter_user_id: userId,
  });
  if (error) throw error;
  return data;
}

async function removeWitness(userId) {
  if (!_sb) throw new Error('Supabase not configured');
  const { data, error } = await _sb.rpc('remove_witness', { user_id: userId });
  if (error) throw error;
  return data;
}

let _witnessChannel = null;
let _witnessRequestChannel = null;

function subscribeWitnessBroadcast(userId, onNotify, onRequestUpdate) {
  if (!_sb) return;
  // Channel for witness notifications (someone I witness is about to skip)
  _witnessChannel = _sb.channel(`witness-${userId}`, {
    config: { broadcast: { ack: false, self: false } },
  });
  _witnessChannel.on('broadcast', { event: 'witness_notify' }, (payload) => {
    if (typeof onNotify === 'function') onNotify(payload.payload);
  });
  _witnessChannel.subscribe();

  // Channel for witness request updates (someone sent me a request)
  _witnessRequestChannel = _sb.channel(`witness-req-${userId}`, {
    config: { broadcast: { ack: false, self: false } },
  });
  _witnessRequestChannel.on('broadcast', { event: 'request_update' }, () => {
    if (typeof onRequestUpdate === 'function') onRequestUpdate();
  });
  _witnessRequestChannel.subscribe();
}

function unsubscribeWitnessBroadcast() {
  if (_witnessChannel) { _sb?.removeChannel(_witnessChannel); _witnessChannel = null; }
  if (_witnessRequestChannel) { _sb?.removeChannel(_witnessRequestChannel); _witnessRequestChannel = null; }
}

function broadcastWitnessNotification(targetUserId, payload) {
  if (!_sb) return;
  _sb.channel(`witness-${targetUserId}`).send({
    type: 'broadcast',
    event: 'witness_notify',
    payload,
  });
}

function broadcastWitnessRequestUpdate(targetUserId) {
  if (!_sb) return;
  _sb.channel(`witness-req-${targetUserId}`).send({
    type: 'broadcast',
    event: 'request_update',
    payload: {},
  });
}