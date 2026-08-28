#!/usr/bin/env node

/**
 * Interactive FortyGuard API Test Script
 * Tests heatmap submission, polling, and environmental parameters
 * 
 * Usage: npm run test:fortyguard
 */

const axios = require('axios');
const readline = require('readline');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const API_KEY = process.env.FORTYGUARD_API_KEY;
const BASE_URL = 'https://api.fortyguard.com/v1';

if (!API_KEY) {
  console.error('❌ ERROR: FORTYGUARD_API_KEY not found in .env');
  process.exit(1);
}

const headers = { 'api-key': API_KEY, 'Content-Type': 'application/json' };

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function testHeatmap() {
  console.log('\n📍 HEATMAP TEST');
  console.log('================\n');
  
  // Example corridor polygon (Bozeman, MT area)
  const polygonCoords = [[
    [-111.05, 45.65],
    [-111.03, 45.65],
    [-111.03, 45.67],
    [-111.05, 45.67],
    [-111.05, 45.65]
  ]];

  const payload = {
    polygon_aoi: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: polygonCoords
        }
      }]
    },
    date_time: {
      start_date: '2024-08-28',
      start_time: '14:00',
      filter_type: 1  // Single hour
    },
    granularity: 100,
    analytic_type: 'tcm'
  };

  console.log('Submitting heatmap request...');
  console.log('Payload:', JSON.stringify(payload, null, 2));

  try {
    const res = await axios.post(`${BASE_URL}/heatmap`, payload, { headers });
    const activityId = res.data.data.activity_id;
    
    console.log(`\n✅ Heatmap submitted!`);
    console.log(`Activity ID: ${activityId}`);
    console.log(`Status: ${res.data.data.status || 'Submitted'}`);

    // Poll for results
    console.log('\nPolling for results...');
    let attempts = 0;
    const maxAttempts = 40;
    
    while (attempts < maxAttempts) {
      const statusRes = await axios.get(`${BASE_URL}/status/${activityId}`, { headers });
      const status = statusRes.data.data.status;
      
      console.log(`[Attempt ${attempts + 1}/${maxAttempts}] Status: ${status}`);
      
      if (status === 'Completed') {
        console.log('\n✅ Heatmap completed!');
        console.log('Temperature stats:', JSON.stringify(statusRes.data.data.result.stats_data.Temperature_stats, null, 2));
        return { success: true, activityId, result: statusRes.data.data.result };
      } else if (status === 'Failed') {
        console.log('\n❌ Heatmap failed!');
        console.log('Message:', statusRes.data.message);
        return { success: false };
      }
      
      attempts++;
      if (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 2500));
      }
    }
    
    console.log('\n⏱️  Polling timed out after 100 seconds');
    return { success: false, timeout: true };
    
  } catch (e) {
    console.error('\n❌ Error:', e.response?.data?.message || e.message);
    return { success: false };
  }
}

async function testEnvParams(lat = 45.66, lng = -111.04, temperature = 28.5) {
  console.log('\n🌡️  ENVIRONMENTAL PARAMETERS TEST');
  console.log('==================================\n');

  const payload = {
    latitude: lat,
    longitude: lng,
    temperature: temperature,
    date_time: {
      start_date: '2024-08-28',
      start_time: '14:00',
      filter_type: 1
    },
    analysis: ['heat_index_celsius', 'apparent_temperature_celsius', 'relative_humidity_percent']
  };

  console.log(`Submitting env_params for: lat=${lat}, lng=${lng}, temp=${temperature}°C`);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  try {
    const res = await axios.post(`${BASE_URL}/env_params`, payload, { headers });
    const activityId = res.data.data.activity_id;
    
    console.log(`\n✅ Env params submitted!`);
    console.log(`Activity ID: ${activityId}`);

    // Poll for results
    console.log('\nPolling for results...');
    let attempts = 0;
    const maxAttempts = 40;
    
    while (attempts < maxAttempts) {
      const statusRes = await axios.get(`${BASE_URL}/status/${activityId}`, { headers });
      const status = statusRes.data.data.status;
      
      console.log(`[Attempt ${attempts + 1}/${maxAttempts}] Status: ${status}`);
      
      if (status === 'Completed') {
        console.log('\n✅ Env params completed!');
        const result = statusRes.data.data.result;
        console.log('Location:', JSON.stringify(result.locations[0], null, 2));
        return { success: true, activityId, result };
      } else if (status === 'Failed') {
        console.log('\n❌ Env params failed!');
        return { success: false };
      }
      
      attempts++;
      if (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 2500));
      }
    }
    
    console.log('\n⏱️  Polling timed out');
    return { success: false, timeout: true };
    
  } catch (e) {
    console.error('\n❌ Error:', e.response?.data?.message || e.message);
    return { success: false };
  }
}

async function testExceedance() {
  console.log('\n⚠️  EXCEEDANCE TEST (Hours Above Threshold)');
  console.log('==========================================\n');

  const polygonCoords = [[
    [-111.05, 45.65],
    [-111.03, 45.65],
    [-111.03, 45.67],
    [-111.05, 45.67],
    [-111.05, 45.65]
  ]];

  const payload = {
    polygon_aoi: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: polygonCoords
        }
      }]
    },
    date_time: {
      start_date: '2024-08-28',
      filter_type: 3  // Single day
    },
    granularity: 100,
    analytic_type: 'exceedance',
    threshold: 35,
    direction: 'above'
  };

  console.log('Submitting exceedance heatmap (hours above 35°C)...');

  try {
    const res = await axios.post(`${BASE_URL}/heatmap`, payload, { headers });
    const activityId = res.data.data.activity_id;
    
    console.log(`✅ Exceedance submitted! Activity ID: ${activityId}`);

    // Poll
    let attempts = 0;
    while (attempts < 40) {
      const statusRes = await axios.get(`${BASE_URL}/status/${activityId}`, { headers });
      if (statusRes.data.data.status === 'Completed') {
        const stats = statusRes.data.data.result.stats_data.Temperature_stats;
        console.log(`\n✅ Result: ${stats.Mean.toFixed(1)} hours above 35°C (avg)`);
        return { success: true, hours: stats.Mean };
      } else if (statusRes.data.data.status === 'Failed') {
        return { success: false };
      }
      attempts++;
      await new Promise(r => setTimeout(r, 2500));
    }
  } catch (e) {
    console.error('❌ Error:', e.response?.data?.message || e.message);
    return { success: false };
  }
}

async function runAllTests() {
  console.log('🧪 FORTY GUARD API TEST SUITE');
  console.log('=============================\n');
  console.log(`API Key configured: ${API_KEY.substring(0, 5)}...`);
  console.log(`Base URL: ${BASE_URL}\n`);

  const test1 = await testHeatmap();
  
  if (test1.success) {
    await testEnvParams();
  }
  
  await testExceedance();

  console.log('\n\n✅ Test suite completed!');
  console.log('========================\n');
  
  rl.close();
}

async function interactiveMode() {
  console.log('🧪 FORTY GUARD API TEST - Interactive Mode');
  console.log('=========================================\n');
  
  let running = true;
  while (running) {
    const choice = await question('\nChoose test:\n1. Heatmap\n2. Environmental Parameters\n3. Exceedance\n4. Run All\n5. Exit\n> ');
    
    switch(choice) {
      case '1':
        await testHeatmap();
        break;
      case '2':
        await testEnvParams();
        break;
      case '3':
        await testExceedance();
        break;
      case '4':
        await runAllTests();
        running = false;
        break;
      case '5':
        running = false;
        break;
      default:
        console.log('Invalid choice');
    }
  }
  
  rl.close();
}

// Auto-run if called without arguments, otherwise interactive
const args = process.argv.slice(2);
if (args.includes('--auto') || args.includes('--all')) {
  runAllTests();
} else {
  interactiveMode();
}
