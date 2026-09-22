const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const app = require('../src/app');
const { query } = require('../src/config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Simple multipart form data builder for tests
function buildMultipartData(boundary, fieldName, filename, fileContent) {
  let body = '';
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`;
  body += `Content-Type: image/jpeg\r\n\r\n`;
  body += fileContent;
  body += `\r\n--${boundary}--\r\n`;
  return body;
}

function makeRequest(server, path, options = {}) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const reqOptions = {
      hostname: '127.0.0.1',
      port: port,
      path: `/api/v1${path}`,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };

    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch (e) {
          parsed = body;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed,
        });
      });
    });

    req.on('error', (err) => reject(err));

    if (options.body && typeof options.body === 'string') {
      req.write(options.body);
    } else if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

const { generateAccessToken } = require('../src/utils/tokens');

function generateToken(user) {
  return generateAccessToken(user);
}

async function setupTestDb() {
  const adminEmail = `admin_${Date.now()}@test.com`;
  const user1Email = `user1_${Date.now()}@test.com`;
  const user2Email = `user2_${Date.now()}@test.com`;
  const pass = await bcrypt.hash('pass123', 10);
  
  // Insert users
  const adminRes = await query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, 'Admin', 'ADMIN') RETURNING id, email, role`, [adminEmail, pass]);
  const user1Res = await query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, 'User 1', 'USER') RETURNING id, email, role`, [user1Email, pass]);
  const user2Res = await query(`INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, 'User 2', 'USER') RETURNING id, email, role`, [user2Email, pass]);
  
  const admin = adminRes.rows[0];
  const user1 = user1Res.rows[0];
  const user2 = user2Res.rows[0];
  
  // Insert draw
  const drawRes = await query(`INSERT INTO monthly_draws (draw_month, draw_type, status, prize_pool_percentage) VALUES ($1, 'RANDOM', 'PUBLISHED', 50.00) RETURNING id`, [`2099-01`]);
  const drawId = drawRes.rows[0].id;
  
  // Insert winners
  const win1Res = await query(`
    INSERT INTO draw_winners (draw_id, user_id, tier, matched_count, user_matched_numbers, prize_amount_cents, status) 
    VALUES ($1, $2, 'MATCH_5', 5, '{1,2,3,4,5}', 500000, 'PENDING_PROOF') RETURNING id
  `, [drawId, user1.id]);
  
  const win2Res = await query(`
    INSERT INTO draw_winners (draw_id, user_id, tier, matched_count, user_matched_numbers, prize_amount_cents, status) 
    VALUES ($1, $2, 'MATCH_4', 4, '{1,2,3,4,6}', 100000, 'PENDING_PROOF') RETURNING id
  `, [drawId, user2.id]);
  
  return {
    admin: { ...admin, token: generateToken(admin) },
    user1: { ...user1, token: generateToken(user1), winId: win1Res.rows[0].id },
    user2: { ...user2, token: generateToken(user2), winId: win2Res.rows[0].id },
    drawId
  };
}

async function cleanupDb(data) {
  if (data.drawId) {
    await query(`DELETE FROM monthly_draws WHERE id = $1`, [data.drawId]);
  }
  if (data.admin) await query(`DELETE FROM users WHERE id = $1`, [data.admin.id]);
  if (data.user1) await query(`DELETE FROM users WHERE id = $1`, [data.user1.id]);
  if (data.user2) await query(`DELETE FROM users WHERE id = $1`, [data.user2.id]);
}

async function runWinnerTests() {
  console.log('🧪 Starting Phase 7 Winner Verification & Payout Test Suite...\n');
  
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_123';
  const server = app.listen(0);
  const data = await setupTestDb();
  
  try {
    // USER ACCESS TESTS
    console.log('Test 1: User can view own winnings');
    let res = await makeRequest(server, '/user/winnings', {
      headers: { Authorization: `Bearer ${data.user1.token}` }
    });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}. Body: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.data.length, 1);
    assert.strictEqual(res.body.data[0].id, data.user1.winId);
    console.log('✅ Test 1 Passed');

    console.log('Test 2: Unauthenticated winnings request -> 401');
    res = await makeRequest(server, '/user/winnings');
    assert.strictEqual(res.status, 401);
    console.log('✅ Test 2 Passed');
    
    console.log('Test 3: USER cannot access admin winner endpoints -> 403');
    res = await makeRequest(server, '/admin/winners', {
      headers: { Authorization: `Bearer ${data.user1.token}` }
    });
    assert.strictEqual(res.status, 403);
    console.log('✅ Test 3 Passed');

    // PROOF TESTS
    console.log('Test 4: Winner can submit valid proof');
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const multipartBody = buildMultipartData(boundary, 'proof', 'test.jpg', 'fake_image_data');
    
    res = await makeRequest(server, `/user/winnings/${data.user1.winId}/proof`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${data.user1.token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: multipartBody
    });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}. Body: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.data.status, 'PROOF_SUBMITTED');
    console.log('✅ Test 4 Passed');

    console.log('Test 5: User cannot submit proof for another winner');
    res = await makeRequest(server, `/user/winnings/${data.user1.winId}/proof`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${data.user2.token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: multipartBody
    });
    assert.strictEqual(res.status, 403);
    console.log('✅ Test 5 Passed');

    // VERIFICATION TESTS
    console.log('Test 6: ADMIN can approve PROOF_SUBMITTED winner');
    res = await makeRequest(server, `/admin/winners/${data.user1.winId}/verify`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${data.admin.token}` },
      body: { action: 'APPROVE' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'VERIFIED');
    assert.ok(res.body.data.verified_at, 'verified_at should be populated');
    assert.strictEqual(res.body.data.verified_by, data.admin.id);
    console.log('✅ Test 6 Passed');

    console.log('Test 7: Proof cannot be changed after VERIFIED');
    res = await makeRequest(server, `/user/winnings/${data.user1.winId}/proof`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${data.user1.token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: multipartBody
    });
    assert.strictEqual(res.status, 409);
    console.log('✅ Test 7 Passed');

    console.log('Test 8: ADMIN can reject proof (requires reason)');
    // User 2 uploads proof first
    await makeRequest(server, `/user/winnings/${data.user2.winId}/proof`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.user2.token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: multipartBody
    });
    // Admin rejects without reason -> 400
    res = await makeRequest(server, `/admin/winners/${data.user2.winId}/verify`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${data.admin.token}` },
      body: { action: 'REJECT' }
    });
    assert.strictEqual(res.status, 400);
    
    // Admin rejects with reason
    res = await makeRequest(server, `/admin/winners/${data.user2.winId}/verify`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${data.admin.token}` },
      body: { action: 'REJECT', rejection_reason: 'Blurry screenshot' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'REJECTED');
    assert.strictEqual(res.body.data.rejection_reason, 'Blurry screenshot');
    console.log('✅ Test 8 Passed');

    // PAYOUT TESTS
    console.log('Test 9: VERIFIED winner can be marked PAID');
    res = await makeRequest(server, `/admin/winners/${data.user1.winId}/payout`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${data.admin.token}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'PAID');
    assert.ok(res.body.data.paid_at, 'paid_at should be populated');
    console.log('✅ Test 9 Passed');

    console.log('Test 10: REJECTED cannot be marked PAID');
    res = await makeRequest(server, `/admin/winners/${data.user2.winId}/payout`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${data.admin.token}` }
    });
    assert.strictEqual(res.status, 409);
    console.log('✅ Test 10 Passed');

    console.log('Test 11: Already PAID cannot be marked PAID again');
    res = await makeRequest(server, `/admin/winners/${data.user1.winId}/payout`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${data.admin.token}` }
    });
    assert.strictEqual(res.status, 409);
    console.log('✅ Test 11 Passed');

    console.log('\n🎉 ALL WINNER VERIFICATION TESTS PASSED SUCCESSFULLY!\n');
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    await cleanupDb(data);
    server.close();
  }
}

if (require.main === module) {
  runWinnerTests();
}

module.exports = runWinnerTests;
