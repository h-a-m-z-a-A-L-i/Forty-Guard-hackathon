#!/usr/bin/env node

/**
 * Startup script for Forty Guard project
 * Validates environment and starts the backend server
 * 
 * Usage: npm start (or node start.js)
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const envPath = path.resolve(__dirname, '.env');
const distPath = path.resolve(__dirname, '../frontend/dist/index.html');

console.log('🚀 Starting Forty Guard Backend\n');

// Check .env
if (!fs.existsSync(envPath)) {
  console.error('❌ ERROR: backend/.env file not found');
  console.error('Please create it with:');
  console.error('  FORTYGUARD_API_KEY=your_api_key_here');
  console.error('  PORT=4000');
  process.exit(1);
}

// Check frontend build
if (!fs.existsSync(distPath)) {
  console.error('❌ ERROR: Frontend not built');
  console.error('Please run: cd ../frontend && npm run build');
  process.exit(1);
}

// Read .env and validate API key
const envContent = fs.readFileSync(envPath, 'utf8');
const apiKeyMatch = envContent.match(/FORTYGUARD_API_KEY\s*=\s*(.+)/);

if (!apiKeyMatch || !apiKeyMatch[1].trim()) {
  console.error('❌ ERROR: FORTYGUARD_API_KEY is empty in .env');
  process.exit(1);
}

console.log('✅ Environment validated');
console.log('✅ Frontend build found');
console.log('✅ API key configured\n');

// Start server
console.log('Starting Express server...\n');
const server = spawn('node', ['server.js'], {
  cwd: __dirname,
  stdio: 'inherit'
});

server.on('error', (err) => {
  console.error('Error starting server:', err);
  process.exit(1);
});

server.on('exit', (code) => {
  if (code !== 0) {
    console.error(`Server exited with code ${code}`);
  }
  process.exit(code);
});

// Handle termination
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  server.kill();
});
