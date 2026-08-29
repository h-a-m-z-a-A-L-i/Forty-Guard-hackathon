/**
 * Minimal .env loader — reads the project ROOT .env (same one the app uses)
 * so the verification pipeline uses the exact same credentials as production.
 * No dotenv dependency needed.
 */
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const root = path.resolve(__dirname, '..', '..');
  const file = path.join(root, '.env');
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const m = trimmed.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // no .env — the run will fail later with a clear message about the key
  }
  return process.env;
}

module.exports = { loadEnv };
