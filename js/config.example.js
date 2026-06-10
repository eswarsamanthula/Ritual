// ============================================================
//  RITUAL — CONFIG (example — fill in your own values)
//  Copy as config.js and replace the placeholders.
// ============================================================

const SUPABASE_URL      = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your_anon_key';

// ─── HABIT COLORS ──────────────────────────────────────────
const HABIT_PALETTE = [
  '#7fb685',
  '#e8a87c',
  '#89b4c9',
  '#c49ac4',
  '#e07b7b',
  '#b5c987',
  '#f0c96e',
  '#8fc9b9',
];

// ─── DEFAULT HABITS (seeded on first login) ────────────────
const DEFAULT_HABITS = [
  { name: 'Water',    icon: '◉', type: 'count',    target: 8,  unit: 'glasses', time_of_day: 'any',       color: '#89b4c9' },
  { name: 'Exercise', icon: '◈', type: 'time',     target: 30, unit: 'min',     time_of_day: 'morning',   color: '#7fb685' },
  { name: 'Sleep',    icon: '◑', type: 'time',     target: 8,  unit: 'hours',   time_of_day: 'evening',   color: '#c49ac4' },
  { name: 'Reading',  icon: '◧', type: 'time',     target: 20, unit: 'min',     time_of_day: 'evening',   color: '#e8a87c' },
];
