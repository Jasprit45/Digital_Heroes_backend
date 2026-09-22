const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const { query } = require('../src/config/database');
const { generateAccessToken } = require('../src/utils/tokens');

function makeRequest(server, path, options = {}) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const reqOptions = {
      hostname: '127.0.0.1',
      port: port,
      path: path,
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

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runScoreTests() {
  console.log('🧪 Starting Phase 4 Golf Score Management Test Suite...\n');

  const server = app.listen(0);

  const timestamp = Date.now();
  const activeUserEmail = `active_score_user_${timestamp}@example.com`;
  const inactiveUserEmail = `inactive_score_user_${timestamp}@example.com`;
  const otherUserEmail = `other_score_user_${timestamp}@example.com`;

  let activeUserId = null;
  let activeUserToken = null;
  let inactiveUserId = null;
  let inactiveUserToken = null;
  let otherUserId = null;
  let otherUserToken = null;

  try {
    // 1. Create Active Subscriber
    const activeRes = await query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ('Active Golfer', $1, 'hash123', 'USER')
       RETURNING id, email, role`,
      [activeUserEmail]
    );
    activeUserId = activeRes.rows[0].id;
    activeUserToken = generateAccessToken(activeRes.rows[0]);

    await query(
      `INSERT INTO subscriptions (user_id, stripe_customer_id, plan, status, price_cents, current_period_end)
       VALUES ($1, 'cus_active_test', 'MONTHLY', 'ACTIVE', 2999, NOW() + INTERVAL '30 days')`,
      [activeUserId]
    );

    // 2. Create Inactive Subscriber
    const inactiveRes = await query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ('Inactive Golfer', $1, 'hash123', 'USER')
       RETURNING id, email, role`,
      [inactiveUserEmail]
    );
    inactiveUserId = inactiveRes.rows[0].id;
    inactiveUserToken = generateAccessToken(inactiveRes.rows[0]);

    await query(
      `INSERT INTO subscriptions (user_id, stripe_customer_id, plan, status, price_cents, current_period_end)
       VALUES ($1, 'cus_inactive_test', 'MONTHLY', 'INACTIVE', 2999, NOW() - INTERVAL '1 day')`,
      [inactiveUserId]
    );

    // 3. Create Other Active Subscriber (for ownership security tests)
    const otherRes = await query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ('Other Golfer', $1, 'hash123', 'USER')
       RETURNING id, email, role`,
      [otherUserEmail]
    );
    otherUserId = otherRes.rows[0].id;
    otherUserToken = generateAccessToken(otherRes.rows[0]);

    await query(
      `INSERT INTO subscriptions (user_id, stripe_customer_id, plan, status, price_cents, current_period_end)
       VALUES ($1, 'cus_other_test', 'MONTHLY', 'ACTIVE', 2999, NOW() + INTERVAL '30 days')`,
      [otherUserId]
    );

    // ----------------------------------------------------
    // Test 1: Unauthenticated request -> 401
    // ----------------------------------------------------
    console.log('Test 1: Unauthenticated request check (401)...');
    const unauthRes = await makeRequest(server, '/api/v1/user/scores', { method: 'GET' });
    assert.strictEqual(unauthRes.status, 401, `Expected 401, got ${unauthRes.status}`);
    console.log('✅ Test 1 Passed: Unauthenticated request rejected with 401.');

    // ----------------------------------------------------
    // Test 2: Inactive subscriber -> 403
    // ----------------------------------------------------
    console.log('\nTest 2: Inactive subscriber check (403)...');
    const inactiveResCheck = await makeRequest(server, '/api/v1/user/scores', {
      method: 'GET',
      headers: { Authorization: `Bearer ${inactiveUserToken}` },
    });
    assert.strictEqual(inactiveResCheck.status, 403, `Expected 403, got ${inactiveResCheck.status}`);
    assert.strictEqual(inactiveResCheck.body.message, 'Active subscription required to access this feature');
    console.log('✅ Test 2 Passed: Inactive subscriber rejected with 403.');

    // ----------------------------------------------------
    // Test 3: GET scores for active subscriber (initially empty)
    // ----------------------------------------------------
    console.log('\nTest 3: GET scores for active subscriber...');
    const getEmptyRes = await makeRequest(server, '/api/v1/user/scores', {
      method: 'GET',
      headers: { Authorization: `Bearer ${activeUserToken}` },
    });
    assert.strictEqual(getEmptyRes.status, 200, `Expected 200, got ${getEmptyRes.status}`);
    assert.deepStrictEqual(getEmptyRes.body.data, []);
    console.log('✅ Test 3 Passed: Returns empty scores array for new active subscriber.');

    // ----------------------------------------------------
    // Validation Failure Tests (Tests 4 to 9)
    // ----------------------------------------------------
    console.log('\nTest 4: Score below 1 check (400)...');
    const scoreZeroRes = await makeRequest(server, '/api/v1/user/scores', {
      method: 'POST',
      headers: { Authorization: `Bearer ${activeUserToken}` },
      body: { score: 0, played_on: '2026-09-01' },
    });
    assert.strictEqual(scoreZeroRes.status, 400);

    console.log('\nTest 5: Score above 45 check (400)...');
    const scoreHighRes = await makeRequest(server, '/api/v1/user/scores', {
      method: 'POST',
      headers: { Authorization: `Bearer ${activeUserToken}` },
      body: { score: 46, played_on: '2026-09-01' },
    });
    assert.strictEqual(scoreHighRes.status, 400);

    console.log('\nTest 6: Non-integer score check (400)...');
    const scoreFloatRes = await makeRequest(server, '/api/v1/user/scores', {
      method: 'POST',
      headers: { Authorization: `Bearer ${activeUserToken}` },
      body: { score: 32.5, played_on: '2026-09-01' },
    });
    assert.strictEqual(scoreFloatRes.status, 400);

    console.log('\nTest 7: Missing date check (400)...');
    const missingDateRes = await makeRequest(server, '/api/v1/user/scores', {
      method: 'POST',
      headers: { Authorization: `Bearer ${activeUserToken}` },
      body: { score: 35 },
    });
    assert.strictEqual(missingDateRes.status, 400);

    console.log('\nTest 8: Future date check (400)...');
    const futureDateRes = await makeRequest(server, '/api/v1/user/scores', {
      method: 'POST',
      headers: { Authorization: `Bearer ${activeUserToken}` },
      body: { score: 35, played_on: '2099-12-31' },
    });
    assert.strictEqual(futureDateRes.status, 400);
    console.log('✅ Tests 4-8 Passed: All input validation bounds enforced with 400.');

    // ----------------------------------------------------
    // Test 9: Add valid score
    // ----------------------------------------------------
    console.log('\nTest 9: Add valid score...');
    const addScoreRes1 = await makeRequest(server, '/api/v1/user/scores', {
      method: 'POST',
      headers: { Authorization: `Bearer ${activeUserToken}` },
      body: { score: 38, played_on: '2026-09-10' },
    });
    assert.strictEqual(addScoreRes1.status, 201);
    assert.strictEqual(addScoreRes1.body.data.length, 1);
    assert.strictEqual(addScoreRes1.body.data[0].score, 38);
    assert.strictEqual(addScoreRes1.body.data[0].played_on, '2026-09-10');
    console.log('✅ Test 9 Passed: Valid score added successfully.');

    // ----------------------------------------------------
    // Test 10: Duplicate date check (409)
    // ----------------------------------------------------
    console.log('\nTest 10: Duplicate date check (409)...');
    const dupDateRes = await makeRequest(server, '/api/v1/user/scores', {
      method: 'POST',
      headers: { Authorization: `Bearer ${activeUserToken}` },
      body: { score: 40, played_on: '2026-09-10' }, // same date as Test 9
    });
    assert.strictEqual(dupDateRes.status, 409, `Expected 409 Conflict, got ${dupDateRes.status}`);
    assert.ok(dupDateRes.body.message.includes('Duplicate scores for the same date are not allowed'));
    console.log('✅ Test 10 Passed: Duplicate score date rejected with 409.');

    // ----------------------------------------------------
    // Test 11: Add 5 scores total & verify newest first order
    // ----------------------------------------------------
    console.log('\nTest 11: Add 4 more scores (5 total) & check reverse chronological order...');
    await makeRequest(server, '/api/v1/user/scores', {
      method: 'POST',
      headers: { Authorization: `Bearer ${activeUserToken}` },
      body: { score: 30, played_on: '2026-09-05' },
    });
    await makeRequest(server, '/api/v1/user/scores', {
      method: 'POST',
      headers: { Authorization: `Bearer ${activeUserToken}` },
      body: { score: 42, played_on: '2026-09-15' },
    });
    await makeRequest(server, '/api/v1/user/scores', {
      method: 'POST',
      headers: { Authorization: `Bearer ${activeUserToken}` },
      body: { score: 25, played_on: '2026-09-01' },
    });
    const add5thRes = await makeRequest(server, '/api/v1/user/scores', {
      method: 'POST',
      headers: { Authorization: `Bearer ${activeUserToken}` },
      body: { score: 36, played_on: '2026-09-12' },
    });

    assert.strictEqual(add5thRes.status, 201);
    assert.strictEqual(add5thRes.body.data.length, 5);

    // Verify ordering by played_on DESC: 2026-09-15, 2026-09-12, 2026-09-10, 2026-09-05, 2026-09-01
    const dates = add5thRes.body.data.map(s => s.played_on);
    assert.deepStrictEqual(dates, ['2026-09-15', '2026-09-12', '2026-09-10', '2026-09-05', '2026-09-01']);
    console.log('✅ Test 11 Passed: 5 scores retained and ordered newest first.');

    // ----------------------------------------------------
    // Test 12: Add 6th score -> Oldest score (2026-09-01) automatically pruned
    // ----------------------------------------------------
    console.log('\nTest 12: Add 6th score (2026-09-20) -> Oldest score (2026-09-01) pruned...');
    const add6thRes = await makeRequest(server, '/api/v1/user/scores', {
      method: 'POST',
      headers: { Authorization: `Bearer ${activeUserToken}` },
      body: { score: 45, played_on: '2026-09-20' },
    });

    assert.strictEqual(add6thRes.status, 201);
    assert.strictEqual(add6thRes.body.data.length, 5);
    const newDates = add6thRes.body.data.map(s => s.played_on);
    assert.deepStrictEqual(newDates, ['2026-09-20', '2026-09-15', '2026-09-12', '2026-09-10', '2026-09-05']);
    assert.strictEqual(newDates.includes('2026-09-01'), false, 'Oldest score 2026-09-01 should be pruned');
    console.log('✅ Test 12 Passed: Rolling 5 pruning correctly removed oldest score.');

    // Save score ID for editing/deleting tests
    const targetScoreId = add6thRes.body.data[2].id; // score for 2026-09-12

    // ----------------------------------------------------
    // Test 13: Edit own score (PUT /scores/:id)
    // ----------------------------------------------------
    console.log('\nTest 13: Edit own score...');
    const editRes = await makeRequest(server, `/api/v1/user/scores/${targetScoreId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${activeUserToken}` },
      body: { score: 39 },
    });

    assert.strictEqual(editRes.status, 200);
    assert.strictEqual(editRes.body.data.score, 39);
    console.log('✅ Test 13 Passed: Score edited successfully.');

    // ----------------------------------------------------
    // Test 14: Edit score to conflicting duplicate date -> 409
    // ----------------------------------------------------
    console.log('\nTest 14: Edit score to date already used by another score (409)...');
    const editDupDateRes = await makeRequest(server, `/api/v1/user/scores/${targetScoreId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${activeUserToken}` },
      body: { played_on: '2026-09-20' }, // date already used by top score
    });

    assert.strictEqual(editDupDateRes.status, 409);
    console.log('✅ Test 14 Passed: Edit to duplicate date rejected with 409.');

    // ----------------------------------------------------
    // Test 15: Edit another user's score -> 404
    // ----------------------------------------------------
    console.log('\nTest 15: Edit another user score check (404)...');
    const editOtherRes = await makeRequest(server, `/api/v1/user/scores/${targetScoreId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${otherUserToken}` },
      body: { score: 44 },
    });

    assert.strictEqual(editOtherRes.status, 404);
    console.log('✅ Test 15 Passed: Editing another user score rejected with 404.');

    // ----------------------------------------------------
    // Test 16: Delete another user's score -> 404
    // ----------------------------------------------------
    console.log('\nTest 16: Delete another user score check (404)...');
    const deleteOtherRes = await makeRequest(server, `/api/v1/user/scores/${targetScoreId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${otherUserToken}` },
    });

    assert.strictEqual(deleteOtherRes.status, 404);
    console.log('✅ Test 16 Passed: Deleting another user score rejected with 404.');

    // ----------------------------------------------------
    // Test 17: Delete own score
    // ----------------------------------------------------
    console.log('\nTest 17: Delete own score...');
    const deleteOwnRes = await makeRequest(server, `/api/v1/user/scores/${targetScoreId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${activeUserToken}` },
    });

    assert.strictEqual(deleteOwnRes.status, 200);
    
    // Verify count dropped to 4
    const getAfterDeleteRes = await makeRequest(server, '/api/v1/user/scores', {
      method: 'GET',
      headers: { Authorization: `Bearer ${activeUserToken}` },
    });
    assert.strictEqual(getAfterDeleteRes.body.data.length, 4);
    console.log('✅ Test 17 Passed: Score deleted successfully.');

    // ----------------------------------------------------
    // Test 18: Concurrency Protection Test (5 simultaneous POST requests)
    // ----------------------------------------------------
    console.log('\nTest 18: Concurrency Protection - Submit 5 simultaneous scores...');
    
    const datesToSubmit = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'];
    
    const concurrentRequests = datesToSubmit.map((d, index) =>
      makeRequest(server, '/api/v1/user/scores', {
        method: 'POST',
        headers: { Authorization: `Bearer ${activeUserToken}` },
        body: { score: 20 + index, played_on: d },
      })
    );

    await Promise.all(concurrentRequests);

    // Verify DB count NEVER exceeds 5
    const finalGetRes = await makeRequest(server, '/api/v1/user/scores', {
      method: 'GET',
      headers: { Authorization: `Bearer ${activeUserToken}` },
    });

    assert.strictEqual(finalGetRes.status, 200);
    assert.strictEqual(finalGetRes.body.data.length, 5, `Expected exactly 5 scores after concurrent inserts, found ${finalGetRes.body.data.length}`);
    console.log('✅ Test 18 Passed: Concurrency lock maintained rolling 5 count without race conditions.');

    // ----------------------------------------------------
    // Cleanup Test Data from DB
    // ----------------------------------------------------
    await query('DELETE FROM golf_scores WHERE user_id IN ($1, $2, $3)', [activeUserId, inactiveUserId, otherUserId]);
    await query('DELETE FROM subscriptions WHERE user_id IN ($1, $2, $3)', [activeUserId, inactiveUserId, otherUserId]);
    await query('DELETE FROM users WHERE id IN ($1, $2, $3)', [activeUserId, inactiveUserId, otherUserId]);

    console.log('\n🎉 ALL GOLF SCORE MANAGEMENT TESTS PASSED SUCCESSFULLY!\n');
  } catch (err) {
    console.error('\n❌ SCORE TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

if (require.main === module) {
  runScoreTests();
}

module.exports = runScoreTests;
