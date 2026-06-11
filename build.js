const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'your_anon_key';

// Build timestamp used to version the service worker cache — bump on every deploy
const BUILD_TS = Date.now();

const config = `const SUPABASE_URL      = '${SUPABASE_URL}';
const SUPABASE_ANON_KEY = '${SUPABASE_ANON_KEY}';

const HABIT_PALETTE = [
  '#7fb685', '#e8a87c', '#89b4c9', '#c49ac4',
  '#e07b7b', '#b5c987', '#f0c96e', '#8fc9b9',
];

const DEFAULT_HABITS = [
  { name: 'Water',    icon: '◉', type: 'count',    target: 8,  unit: 'glasses', time_of_day: 'any',       color: '#89b4c9' },
  { name: 'Exercise', icon: '◈', type: 'time',     target: 30, unit: 'min',     time_of_day: 'morning',   color: '#7fb685' },
  { name: 'Sleep',    icon: '◑', type: 'time',     target: 8,  unit: 'hours',   time_of_day: 'evening',   color: '#c49ac4' },
  { name: 'Reading',  icon: '◧', type: 'time',     target: 20, unit: 'min',     time_of_day: 'evening',   color: '#e8a87c' },
];
`;

const dir = path.join(__dirname, 'js');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'config.js'), config);
console.log('✓ Generated js/config.js');

// Rewrite sw.js with a fresh cache version so stale assets are evicted on deploy
const swPath = path.join(__dirname, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
sw = sw.replace(/const CACHE = 'ritual-[^']+';/, `const CACHE = 'ritual-${BUILD_TS}';`);
fs.writeFileSync(swPath, sw);
console.log(`✓ sw.js cache version → ritual-${BUILD_TS}`);