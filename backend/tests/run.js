// Minimal zero-dependency test runner for ShadeRoute.
// Defines global describe/it/test hooks, then requires each test file.
// Usage: node tests/run.js  (wired as `npm test`)

const assert = require('assert');

const tests = [];
let currentSuite = 'root';
let passed = 0;
let failed = 0;

global.describe = (name, fn) => {
  const parent = currentSuite;
  currentSuite = `${parent} > ${name}`;
  fn();
  currentSuite = parent;
};

global.it = global.test = (name, fn) => {
  tests.push({ name: `${currentSuite} > ${name}`, fn });
};

async function run() {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${t.name}`);
      console.error(`    ${e.message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

// Load test files (relative to this runner's directory)
const path = require('path');
const testFiles = process.argv.slice(2);
for (const file of testFiles) {
  require(path.resolve(__dirname, file));
}
run();
