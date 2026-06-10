// ============================================================
//  RITUAL — DATABASE LAYER
//  Auth reused from Limitless. Habits + logs are new.
// ============================================================

let _sb = null;
let currentUser = null;
let _channels = [];

// ─── INIT ───────────────────────────────────────────────────
function initSupabase() {
  if (SUPABASE_URL === 'YOUR_SUPABASE_URL') return false;
  try {
    _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        storage: localStorage,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    return true;
  } catch (e) {
    console.warn('Supabase init failed:', e);
    return false;
  }
}

// ─── AUTH — GOOGLE ───────────────────────────────────────────
async function signInWithGoogle() {
  if (!_sb) throw new Error('Supabase not configured');
  const { error } = await _sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href }
  });
  if (error) throw error;
}

// ─── AUTH — EMAIL SIGN UP ────────────────────────────────────
async function signUpWithEmail(email, password) {
  if (!_sb) throw new Error('Supabase not configured');
  const { data, error } = await _sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: window.location.href }
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
  if (habit.id) {
    const { error } = await _sb.from('habits')
      .update(payload)
      .eq('id', habit.id)
      .eq('user_id', currentUser.id);
    if (error) throw error;
  } else {
    const { error } = await _sb.from('habits')
      .insert({ ...payload, user_id: currentUser.id });
    if (error) throw error;
  }
}

async function deleteHabit(id) {
  if (!_sb || !currentUser) throw new Error('Not authenticated');
  const { error } = await _sb.from('habits')
    .delete()
    .eq('id', id)
    .eq('user_id', currentUser.id);
  if (error) throw error;
}

async function reorderHabits(orderedIds) {
  if (!_sb || !currentUser) throw new Error('Not authenticated');
  await Promise.all(orderedIds.map((id, i) =>
    _sb.from('habits').update({ sort_order: i }).eq('id', id).eq('user_id', currentUser.id)
  ));
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
  const { error } = await _sb.from('habit_logs').upsert({
    user_id: currentUser.id,
    habit_id: habitId,
    date: dateStr,
    value: value,
    note: note || null,
    logged_at: new Date().toISOString(),
  }, { onConflict: 'habit_id,date' });
  if (error) throw error;
}

async function deleteLog(habitId, dateStr) {
  if (!_sb || !currentUser) throw new Error('Not authenticated');
  const { error } = await _sb.from('habit_logs')
    .delete()
    .eq('user_id', currentUser.id)
    .eq('habit_id', habitId)
    .eq('date', dateStr);
  if (error) throw error;
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
  ['habits', 'habit_logs'].forEach(table => {
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
