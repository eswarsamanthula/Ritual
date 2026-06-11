// ============================================================
//  RITUAL — CONFIG
//  Same Supabase project as Limitless — copy your keys here.
//  Get from: https://supabase.com → Project → Settings → API
// ============================================================

const SUPABASE_URL      = 'https://cuhjdrbzyazhyuhdcrri.supabase.co';       // same as Limitless
const SUPABASE_ANON_KEY = 'sb_publishable_LZeC_lX1VliPk3T3KBW8LA_9_3Kdic8';  // same as Limitless

// ─── HABIT COLORS ──────────────────────────────────────────
const HABIT_PALETTE = [
  '#7fb685', // sage green
  '#e8a87c', // warm amber
  '#89b4c9', // calm blue
  '#c49ac4', // dusty lavender
  '#e07b7b', // soft red
  '#b5c987', // olive
  '#f0c96e', // golden
  '#8fc9b9', // teal
];

// ─── DEFAULT HABITS (seeded on first login) ────────────────
const DEFAULT_HABITS = [
  { name: 'Water',    icon: '◉', type: 'count',    target: 8,  unit: 'glasses', time_of_day: 'any',       color: '#89b4c9' },
  { name: 'Exercise', icon: '◈', type: 'time',     target: 30, unit: 'min',     time_of_day: 'morning',   color: '#7fb685' },
  { name: 'Sleep',    icon: '◑', type: 'time',     target: 8,  unit: 'hours',   time_of_day: 'evening',   color: '#c49ac4' },
  { name: 'Reading',  icon: '◧', type: 'time',     target: 20, unit: 'min',     time_of_day: 'evening',   color: '#e8a87c' },
];
