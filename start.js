#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🚀 Twitter Scraper - Environment Check');
console.log('=====================================');

// Check if we're in the right directory
const packageJsonPath = path.join(__dirname, 'package.json');
if (!fs.existsSync(packageJsonPath)) {
  console.error('❌ package.json not found. Please run this script from the project root directory.');
  process.exit(1);
}

// Check if node_modules exists
const nodeModulesPath = path.join(__dirname, 'node_modules');
if (!fs.existsSync(nodeModulesPath)) {
  console.error('❌ node_modules not found. Please run "npm install" or "pnpm install" first.');
  process.exit(1);
}

// Initialize all required directories
const directories = [
  'data',
  'data/cookies',
  'data/tweets', 
  'data/csv',
  'data/analysis',
  'data/uploads'
];

console.log('📁 Creating directories...');
directories.forEach(dir => {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✅ Created: ${dir}`);
    } catch (error) {
      console.error(`❌ Failed to create ${dir}:`, error.message);
    }
  } else {
    console.log(`✅ Exists: ${dir}`);
  }
});

// Check if jobs file exists, create if not
const jobsFile = 'data/jobs.json';
if (!fs.existsSync(jobsFile)) {
  try {
    fs.writeFileSync(jobsFile, JSON.stringify([], null, 2));
    console.log('✅ Created: data/jobs.json');
  } catch (error) {
    console.error('❌ Failed to create jobs.json:', error.message);
  }
} else {
  console.log('✅ Exists: data/jobs.json');
}

// Check for required environment variables
console.log('\n🔧 Environment check...');
const port = process.env.PORT || 3000;
console.log(`✅ Port: ${port}`);

// Check if Chrome/Chromium is available (for Puppeteer)
console.log('\n🌐 Browser check...');
try {
  const { execSync } = require('child_process');
  execSync('which google-chrome || which chromium-browser || which chromium', { stdio: 'ignore' });
  console.log('✅ Chrome/Chromium found');
} catch (error) {
  console.warn('⚠️  Chrome/Chromium not found in PATH. Puppeteer will download its own version.');
}

console.log('\n✅ Environment check complete!');
console.log('🚀 Starting server...\n');

// Start the main server
require('./index.js'); 