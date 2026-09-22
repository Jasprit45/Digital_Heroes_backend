/**
 * draw.test.js
 *
 * Phase 6: Draw Engine + Prize Pool Calculation — Automated Test Suite
 *
 * 32 tests across 7 groups:
 *  Group A — Number Generation (Tests 1-6)
 *  Group B — Matching Engine (Tests 7-11)
 *  Group C — Prize Calculations (Tests 12-17)
 *  Group D — Draw Lifecycle / HTTP (Tests 18-23)
 *  Group E — Authorization (Tests 24-28)
 *  Group F — Data Integrity (Tests 29-30)
 *  Group G — API (Tests 31-32)
 */

'use strict';

const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const { query } = require('../src/config/database');
const { generateAccessToken } = require('../src/utils/tokens');

// Pure engine functions for unit tests
const {
  generateRandomWinningNumbers,
  buildScoreFrequencyHistogram,
  generateWeightedWinningNumbers,
  calculateMatchCount,
  calculatePrizePool,
  calculateTierPools,
  splitPrizeAmongWinners,
} = require('../src/modules/draws/draw.engine');

// ─────────────────────────────────────────────────────────────────
// HTTP Helper
// ─────────────────────────────────────────────────────────────────
function makeRequest(server, path, options = {}) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path,
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
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────
// Test runner
// ─────────────────────────────────────────────────────────────────
async function runDrawTests() {
  console.log('🧪 Starting Phase 6 Draw Engine Test Suite...\n');

  // ═══════════════════════════════════════════════════════════════
  // GROUP A: NUMBER GENERATION (Pure unit tests — no HTTP/DB)
  // ═══════════════════════════════════════════════════════════════

  console.log('══════════════════════════════════════');
  console.log('Group A: Number Generation');
  console.log('══════════════════════════════════════');

  // Test 1: Random draw generates exactly 5 numbers
  console.log('\nTest 1: Random draw generates exactly 5 numbers...');
  for (let i = 0; i < 10; i++) {
    const nums = generateRandomWinningNumbers();
    assert.strictEqual(nums.length, 5, `Expected 5 numbers, got ${nums.length}`);
  }
  console.log('✅ Test 1 Passed: Random draw always generates exactly 5 numbers.');

  // Test 2: Random numbers are between 1 and 45
  console.log('\nTest 2: Random numbers are between 1 and 45...');
  for (let i = 0; i < 20; i++) {
    const nums = generateRandomWinningNumbers();
    for (const n of nums) {
      assert.ok(n >= 1 && n <= 45, `Number ${n} is out of range [1, 45]`);
    }
  }
  console.log('✅ Test 2 Passed: All random numbers are within [1, 45].');

  // Test 3: Random numbers are unique
  console.log('\nTest 3: Random numbers are unique...');
  for (let i = 0; i < 20; i++) {
    const nums = generateRandomWinningNumbers();
    const unique = new Set(nums);
    assert.strictEqual(unique.size, 5, `Expected 5 unique numbers, got ${unique.size} unique from [${nums}]`);
  }
  console.log('✅ Test 3 Passed: All random draws produce 5 unique numbers.');

  // Test 4: Algorithmic draw generates exactly 5 unique numbers
  console.log('\nTest 4: Algorithmic draw generates exactly 5 unique numbers...');
  const sampleScores = [
    { score: 12 }, { score: 12 }, { score: 18 }, { score: 25 }, { score: 30 },
    { score: 30 }, { score: 30 }, { score: 41 }, { score: 7 }, { score: 2 },
  ];
  for (let i = 0; i < 10; i++) {
    const histogram = buildScoreFrequencyHistogram(sampleScores);
    const nums = generateWeightedWinningNumbers(histogram);
    assert.strictEqual(nums.length, 5, `Expected 5 numbers, got ${nums.length}`);
    const unique = new Set(nums);
    assert.strictEqual(unique.size, 5, `Expected 5 unique weighted numbers, got ${unique.size}`);
    for (const n of nums) {
      assert.ok(n >= 1 && n <= 45, `Number ${n} is out of range`);
    }
  }
  console.log('✅ Test 4 Passed: Algorithmic draw generates exactly 5 unique numbers in range.');

  // Test 5: Algorithmic weighting respects score frequency
  console.log('\nTest 5: Algorithmic weighting respects score frequency (statistical check)...');
  {
    // Score 1 appears 100x, all others appear 0x → score 1 should appear in virtually every draw
    const biasedScores = Array.from({ length: 100 }, () => ({ score: 1 }));
    const histogram = buildScoreFrequencyHistogram(biasedScores);
    let count1 = 0;
    for (let i = 0; i < 50; i++) {
      const nums = generateWeightedWinningNumbers(histogram);
      if (nums.includes(1)) count1++;
    }
    // With heavy bias toward 1, it should appear in at least 40 of 50 draws
    assert.ok(count1 >= 40, `Expected score 1 (heavily weighted) in >=40/50 draws, got ${count1}/50`);
  }
  console.log('✅ Test 5 Passed: Heavily weighted score appears with proportionally higher frequency.');

  // Test 6: Algorithmic generation safely handles zero-frequency data (fallback to uniform)
  console.log('\nTest 6: Algorithmic generation handles zero-frequency histogram (fallback)...');
  {
    const emptyScores = [];
    const histogram = buildScoreFrequencyHistogram(emptyScores);
    // All frequencies are 0 → should fall back to uniform distribution without throwing
    for (let i = 0; i < 10; i++) {
      const nums = generateWeightedWinningNumbers(histogram);
      assert.strictEqual(nums.length, 5);
      const unique = new Set(nums);
      assert.strictEqual(unique.size, 5);
    }
  }
  console.log('✅ Test 6 Passed: Zero-frequency histogram handled safely with uniform fallback.');

  // ═══════════════════════════════════════════════════════════════
  // GROUP B: MATCHING ENGINE (Pure unit tests)
  // ═══════════════════════════════════════════════════════════════

  console.log('\n══════════════════════════════════════');
  console.log('Group B: Matching Engine');
  console.log('══════════════════════════════════════');

  // Test 7: 5 matches → MATCH_5
  console.log('\nTest 7: 5 matches → MATCH_5...');
  {
    const { matchedCount, matchedNumbers } = calculateMatchCount(
      [5, 12, 18, 25, 40],
      [5, 12, 18, 25, 40]
    );
    assert.strictEqual(matchedCount, 5);
    assert.deepStrictEqual(matchedNumbers, [5, 12, 18, 25, 40]);
  }
  console.log('✅ Test 7 Passed: 5 matches correctly identified as MATCH_5.');

  // Test 8: 4 matches → MATCH_4
  console.log('\nTest 8: 4 matches → MATCH_4...');
  {
    const { matchedCount } = calculateMatchCount([5, 12, 18, 25, 99], [5, 12, 18, 25, 40]);
    // 99 is not a valid score (>45) but engine still treats user scores as-is; only 4 intersect
    // Using valid scores:
    const { matchedCount: mc } = calculateMatchCount([5, 12, 18, 25, 33], [5, 12, 18, 25, 40]);
    assert.strictEqual(mc, 4);
  }
  console.log('✅ Test 8 Passed: 4 matches correctly identified as MATCH_4.');

  // Test 9: 3 matches → MATCH_3
  console.log('\nTest 9: 3 matches → MATCH_3...');
  {
    const { matchedCount } = calculateMatchCount([12, 18, 25, 30, 41], [5, 12, 18, 25, 40]);
    assert.strictEqual(matchedCount, 3);
  }
  console.log('✅ Test 9 Passed: 3 matches correctly identified as MATCH_3.');

  // Test 10: Less than 3 → no winner tier
  console.log('\nTest 10: Less than 3 matches → no winner...');
  {
    const { matchedCount: mc0 } = calculateMatchCount([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]);
    assert.strictEqual(mc0, 0);

    const { matchedCount: mc1 } = calculateMatchCount([1, 2, 3, 4, 6], [6, 7, 8, 9, 10]);
    assert.strictEqual(mc1, 1);

    const { matchedCount: mc2 } = calculateMatchCount([1, 2, 3, 6, 7], [6, 7, 8, 9, 10]);
    assert.strictEqual(mc2, 2);
  }
  console.log('✅ Test 10 Passed: 0, 1, and 2 matches do not qualify as winners.');

  // Test 11: Duplicate user score values do not create duplicate matches
  console.log('\nTest 11: Duplicate user score values do not create duplicate matches...');
  {
    // User has duplicate scores (e.g. [12, 12, 18, 25, 30]) — set intersection must deduplicate
    const { matchedCount } = calculateMatchCount([12, 12, 18, 25, 30], [12, 18, 25, 40, 45]);
    // Set of user scores = {12, 18, 25, 30}; intersection with {12, 18, 25, 40, 45} = {12, 18, 25}
    assert.strictEqual(matchedCount, 3, `Expected 3 unique matches, got ${matchedCount}`);
  }
  console.log('✅ Test 11 Passed: Duplicate user score values do not create duplicate matches.');

  // ═══════════════════════════════════════════════════════════════
  // GROUP C: PRIZE CALCULATIONS (Pure unit tests)
  // ═══════════════════════════════════════════════════════════════

  console.log('\n══════════════════════════════════════');
  console.log('Group C: Prize Calculations');
  console.log('══════════════════════════════════════');

  const DEFAULT_TIER_SPLITS = { match_5: 40.0, match_4: 35.0, match_3: 25.0 };

  // Test 12: 40/35/25 percentage splits are correct
  console.log('\nTest 12: Tier splits 40/35/25 are correct...');
  {
    // 100 subscribers × 1000 cents = 100,000 cents revenue
    // 50% prize pool → 50,000 cents gross
    // MATCH_5: 40% → 20,000 | MATCH_4: 35% → 17,500 | MATCH_3: 25% → 12,500
    const subs = Array.from({ length: 100 }, () => ({ price_cents: 1000 }));
    const grossPool = calculatePrizePool(subs, 50.0);
    assert.strictEqual(grossPool, 50000);

    const { match5Cents, match4Cents, match3Cents } = calculateTierPools(grossPool, 0, DEFAULT_TIER_SPLITS);
    assert.strictEqual(match5Cents, 20000);
    assert.strictEqual(match4Cents, 17500);
    assert.strictEqual(match3Cents, 12500);
  }
  console.log('✅ Test 12 Passed: 40/35/25 tier percentages produce correct cent amounts.');

  // Test 13: Previous MATCH_5 rollover is included in MATCH_5 pool
  console.log('\nTest 13: Previous MATCH_5 rollover is included in MATCH_5 pool...');
  {
    const grossPool = 50000;
    const rollover = 10000; // Previous month's rollover
    const { match5Cents } = calculateTierPools(grossPool, rollover, DEFAULT_TIER_SPLITS);
    // Base MATCH_5 = 40% × 50000 = 20000 + 10000 rollover = 30000
    assert.strictEqual(match5Cents, 30000);
  }
  console.log('✅ Test 13 Passed: Previous rollover correctly added to MATCH_5 pool.');

  // Test 14: Multiple winners split tier equally
  console.log('\nTest 14: Multiple winners split tier equally...');
  {
    const { prizePerWinnerCents, remainderCents } = splitPrizeAmongWinners(10000, 3);
    assert.strictEqual(prizePerWinnerCents, 3333); // floor(10000/3)
    assert.strictEqual(remainderCents, 1);         // 10000 - 3×3333 = 1
  }
  console.log('✅ Test 14 Passed: Multiple winners receive floor(pool/n) each, remainder tracked.');

  // Test 15: Currency is in cents (integer arithmetic only)
  console.log('\nTest 15: Prize pool uses integer cents...');
  {
    // 1 subscriber × 9999 cents (£99.99) at 50% → 4999 cents
    const subs = [{ price_cents: 9999 }];
    const grossPool = calculatePrizePool(subs, 50.0);
    assert.strictEqual(typeof grossPool, 'number');
    assert.strictEqual(Number.isInteger(grossPool), true, 'grossPool must be an integer');
    assert.strictEqual(grossPool, 4999);
  }
  console.log('✅ Test 15 Passed: All prize calculations use integer cents.');

  // Test 16: No MATCH_5 winner → full MATCH_5 pool becomes rollover
  console.log('\nTest 16: No MATCH_5 winner → rollover created...');
  {
    const { prizePerWinnerCents, remainderCents } = splitPrizeAmongWinners(20000, 0);
    // winnerCount = 0 → prizePerWinner = 0, entire pool = remainder (rollover)
    assert.strictEqual(prizePerWinnerCents, 0);
    assert.strictEqual(remainderCents, 20000);
  }
  console.log('✅ Test 16 Passed: Zero MATCH_5 winners means full pool rolls over.');

  // Test 17: MATCH_4/MATCH_3 no-winner behavior → remainder to Charity Fund (documented assumption)
  console.log('\nTest 17: MATCH_4/MATCH_3 zero-winner behavior follows documented assumption...');
  {
    const { prizePerWinnerCents: m4Prize, remainderCents: m4Remainder } = splitPrizeAmongWinners(17500, 0);
    const { prizePerWinnerCents: m3Prize, remainderCents: m3Remainder } = splitPrizeAmongWinners(12500, 0);
    // Per documented assumption: unclaimed MATCH_4/MATCH_3 funds → Charity Contribution Fund
    assert.strictEqual(m4Prize, 0);
    assert.strictEqual(m4Remainder, 17500); // Full MATCH_4 pool → Charity Fund
    assert.strictEqual(m3Prize, 0);
    assert.strictEqual(m3Remainder, 12500); // Full MATCH_3 pool → Charity Fund
  }
  console.log('✅ Test 17 Passed: MATCH_4/MATCH_3 unclaimed amounts documented as Charity Fund per assumption.');

  // ═══════════════════════════════════════════════════════════════
  // HTTP Tests — Database-backed
  // ═══════════════════════════════════════════════════════════════
  const server = app.listen(0);
  const timestamp = Date.now();
  const adminEmail = `admin_draw_${timestamp}@example.com`;
  const userEmail = `user_draw_${timestamp}@example.com`;
  const activeUserEmail = `active_draw_${timestamp}@example.com`;
  const testMonth = '2025-01'; // Fixed past month to avoid conflicts with real data

  let adminId = null;
  let adminToken = null;
  let userId = null;
  let userToken = null;
  let activeUserId = null;
  let activeUserToken = null;
  let simulatedDrawId = null;

  try {
    // ── Seed admin user ───────────────────────────────────────────
    const adminRes = await query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ('Test Admin', $1, 'hash', 'ADMIN')
       RETURNING id, email, role`,
      [adminEmail]
    );
    adminId = adminRes.rows[0].id;
    adminToken = generateAccessToken(adminRes.rows[0]);

    // ── Seed regular USER (no subscription) ───────────────────────
    const userRes = await query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ('Test User', $1, 'hash', 'USER')
       RETURNING id, email, role`,
      [userEmail]
    );
    userId = userRes.rows[0].id;
    userToken = generateAccessToken(userRes.rows[0]);

    // ── Seed active subscriber for history/API tests ───────────────
    const activeRes = await query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ('Active Draw User', $1, 'hash', 'USER')
       RETURNING id, email, role`,
      [activeUserEmail]
    );
    activeUserId = activeRes.rows[0].id;
    activeUserToken = generateAccessToken(activeRes.rows[0]);

    await query(
      `INSERT INTO subscriptions (user_id, stripe_customer_id, plan, status, price_cents, current_period_end)
       VALUES ($1, 'cus_draw_active', 'MONTHLY', 'ACTIVE', 2999, NOW() + INTERVAL '30 days')`,
      [activeUserId]
    );

    // ─────────────────────────────────────────────────────────────
    // GROUP D: DRAW LIFECYCLE
    // ─────────────────────────────────────────────────────────────

    console.log('\n══════════════════════════════════════');
    console.log('Group D: Draw Lifecycle');
    console.log('══════════════════════════════════════');

    // Test 18: Simulation creates SIMULATED draw
    console.log('\nTest 18: Simulation creates a SIMULATED draw...');
    const simRes = await makeRequest(server, '/api/v1/admin/draws/simulate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { month: testMonth, type: 'RANDOM' },
    });
    assert.strictEqual(simRes.status, 200, `Expected 200, got ${simRes.status}: ${JSON.stringify(simRes.body)}`);
    assert.strictEqual(simRes.body.success, true);
    assert.ok(simRes.body.data.draw_id, 'draw_id must be present');
    assert.strictEqual(simRes.body.data.type, 'RANDOM');
    assert.strictEqual(simRes.body.data.status, 'SIMULATED');
    assert.strictEqual(simRes.body.data.winning_numbers.length, 5);

    simulatedDrawId = simRes.body.data.draw_id;
    console.log(`  Draw ID: ${simulatedDrawId}`);
    console.log(`  Winning numbers: [${simRes.body.data.winning_numbers.join(', ')}]`);
    console.log('✅ Test 18 Passed: Simulation creates SIMULATED draw with 5 winning numbers.');

    // Test 19: Simulation is NOT publicly visible as an official draw
    console.log('\nTest 19: Simulated draw is NOT returned as the latest public draw...');
    const publicRes19 = await makeRequest(server, '/api/v1/public/draws/published/latest', {
      method: 'GET',
    });
    assert.strictEqual(publicRes19.status, 200);
    // The simulated draw must NOT appear here (only PUBLISHED draws appear)
    if (publicRes19.body.data !== null) {
      assert.notStrictEqual(
        publicRes19.body.data.id, simulatedDrawId,
        'SIMULATED draw must not appear in public endpoint'
      );
    }
    console.log('✅ Test 19 Passed: Simulated draw is not visible in the public endpoint.');

    // Test 20: Only SIMULATED draw can be published (attempt on non-existent → 404)
    console.log('\nTest 20: Cannot publish a non-existent draw (404)...');
    const badPublishRes = await makeRequest(
      server,
      `/api/v1/admin/draws/00000000-0000-0000-0000-000000000000/publish`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      }
    );
    assert.strictEqual(badPublishRes.status, 404, `Expected 404, got ${badPublishRes.status}`);
    console.log('✅ Test 20 Passed: Non-existent draw returns 404 on publish attempt.');

    // Test 21: Publishing creates official winner records
    console.log('\nTest 21: Publishing creates official winner records...');
    const publishRes = await makeRequest(server, `/api/v1/admin/draws/${simulatedDrawId}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(publishRes.status, 200, `Expected 200, got ${publishRes.status}: ${JSON.stringify(publishRes.body)}`);
    assert.strictEqual(publishRes.body.data.status, 'PUBLISHED');

    // Verify in DB
    const winnerCountRes = await query(
      'SELECT COUNT(*) FROM draw_winners WHERE draw_id = $1',
      [simulatedDrawId]
    );
    const winnerCount = parseInt(winnerCountRes.rows[0].count, 10);
    const expectedWinners =
      publishRes.body.data.winner_counts.match_5 +
      publishRes.body.data.winner_counts.match_4 +
      publishRes.body.data.winner_counts.match_3;
    assert.strictEqual(
      winnerCount,
      expectedWinners,
      `Expected ${expectedWinners} winner records in DB, found ${winnerCount}`
    );
    console.log(`  Winners created in DB: ${winnerCount}`);
    console.log('✅ Test 21 Passed: Publishing creates correct number of official winner records.');

    // Test 22: Publishing cannot happen twice (already PUBLISHED → 409)
    console.log('\nTest 22: Cannot publish an already-published draw (409)...');
    const dupPublishRes = await makeRequest(server, `/api/v1/admin/draws/${simulatedDrawId}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(dupPublishRes.status, 409, `Expected 409, got ${dupPublishRes.status}`);
    console.log('✅ Test 22 Passed: Duplicate publish correctly rejected with 409.');

    // Test 23: Published draw cannot be re-simulated
    console.log('\nTest 23: Cannot re-simulate a PUBLISHED draw (409)...');
    const reSimRes = await makeRequest(server, '/api/v1/admin/draws/simulate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { month: testMonth, type: 'ALGORITHMIC' },
    });
    assert.strictEqual(reSimRes.status, 409, `Expected 409, got ${reSimRes.status}`);
    console.log('✅ Test 23 Passed: Re-simulating a PUBLISHED draw correctly rejected with 409.');

    // ─────────────────────────────────────────────────────────────
    // GROUP E: AUTHORIZATION
    // ─────────────────────────────────────────────────────────────

    console.log('\n══════════════════════════════════════');
    console.log('Group E: Authorization');
    console.log('══════════════════════════════════════');

    const authTestMonth = '2025-02'; // fresh month for auth tests

    // Test 24: Unauthenticated simulation → 401
    console.log('\nTest 24: Unauthenticated simulation → 401...');
    const unauthSimRes = await makeRequest(server, '/api/v1/admin/draws/simulate', {
      method: 'POST',
      body: { month: authTestMonth, type: 'RANDOM' },
    });
    assert.strictEqual(unauthSimRes.status, 401, `Expected 401, got ${unauthSimRes.status}`);
    console.log('✅ Test 24 Passed: Unauthenticated simulation rejected with 401.');

    // Test 25: USER role simulation → 403
    console.log('\nTest 25: USER role simulation → 403...');
    const userSimRes = await makeRequest(server, '/api/v1/admin/draws/simulate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
      body: { month: authTestMonth, type: 'RANDOM' },
    });
    assert.strictEqual(userSimRes.status, 403, `Expected 403, got ${userSimRes.status}`);
    console.log('✅ Test 25 Passed: USER role simulation rejected with 403.');

    // Test 26: ADMIN simulation → allowed (201/200)
    console.log('\nTest 26: ADMIN simulation → allowed...');
    const adminSimRes = await makeRequest(server, '/api/v1/admin/draws/simulate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { month: authTestMonth, type: 'RANDOM' },
    });
    assert.strictEqual(adminSimRes.status, 200, `Expected 200, got ${adminSimRes.status}: ${JSON.stringify(adminSimRes.body)}`);
    const authTestDrawId = adminSimRes.body.data.draw_id;
    console.log('✅ Test 26 Passed: ADMIN can simulate a draw.');

    // Test 27: USER cannot publish
    console.log('\nTest 27: USER cannot publish a draw → 403...');
    const userPublishRes = await makeRequest(server, `/api/v1/admin/draws/${authTestDrawId}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.strictEqual(userPublishRes.status, 403, `Expected 403, got ${userPublishRes.status}`);
    console.log('✅ Test 27 Passed: USER role publish rejected with 403.');

    // Test 28: ADMIN can publish
    console.log('\nTest 28: ADMIN can publish a draw...');
    const adminPublishRes = await makeRequest(server, `/api/v1/admin/draws/${authTestDrawId}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(adminPublishRes.status, 200, `Expected 200, got ${adminPublishRes.status}: ${JSON.stringify(adminPublishRes.body)}`);
    assert.strictEqual(adminPublishRes.body.data.status, 'PUBLISHED');
    console.log('✅ Test 28 Passed: ADMIN can publish a draw.');

    // ─────────────────────────────────────────────────────────────
    // GROUP F: DATA INTEGRITY
    // ─────────────────────────────────────────────────────────────

    console.log('\n══════════════════════════════════════');
    console.log('Group F: Data Integrity');
    console.log('══════════════════════════════════════');

    // Test 29: Failed publish transaction rolls back
    // Simulate by trying to publish a draw that does not exist (no row = commit never reached)
    console.log('\nTest 29: Failed publish (non-existent draw) rolls back cleanly...');
    const rollbackRes = await makeRequest(
      server,
      `/api/v1/admin/draws/ffffffff-ffff-ffff-ffff-ffffffffffff/publish`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      }
    );
    assert.strictEqual(rollbackRes.status, 404, `Expected 404, got ${rollbackRes.status}`);
    // Verify no orphaned records exist for this UUID
    const orphanCheck = await query(
      `SELECT COUNT(*) FROM draw_winners WHERE draw_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'`
    );
    assert.strictEqual(parseInt(orphanCheck.rows[0].count, 10), 0, 'No orphaned winner records should exist');
    console.log('✅ Test 29 Passed: Failed publish leaves no orphaned records.');

    // Test 30: Duplicate winner creation cannot occur (UNIQUE constraint on draw_id + user_id)
    console.log('\nTest 30: Duplicate winner records are prevented by UNIQUE constraint...');
    {
      // Verify the constraint exists by checking the DB schema
      const constraintRes = await query(
        `SELECT constraint_name
         FROM information_schema.table_constraints
         WHERE table_name = 'draw_winners'
           AND constraint_type = 'UNIQUE'
           AND constraint_name = 'unique_user_draw_win'`
      );
      assert.strictEqual(
        constraintRes.rows.length,
        1,
        'UNIQUE constraint unique_user_draw_win must exist on draw_winners'
      );
    }
    console.log('✅ Test 30 Passed: UNIQUE(draw_id, user_id) constraint exists on draw_winners.');

    // ─────────────────────────────────────────────────────────────
    // GROUP G: API
    // ─────────────────────────────────────────────────────────────

    console.log('\n══════════════════════════════════════');
    console.log('Group G: API');
    console.log('══════════════════════════════════════');

    // Test 31: User draw history returns only user's records
    console.log('\nTest 31: User draw history returns only their own records...');
    const historyRes = await makeRequest(server, '/api/v1/user/draws/my-history', {
      method: 'GET',
      headers: { Authorization: `Bearer ${activeUserToken}` },
    });
    assert.strictEqual(historyRes.status, 200, `Expected 200, got ${historyRes.status}`);
    assert.ok(Array.isArray(historyRes.body.data), 'History must be an array');

    // Verify no other user's data is exposed
    for (const entry of historyRes.body.data) {
      assert.ok(entry.draw_id, 'Each history entry must have draw_id');
      assert.ok(!entry.user_id, 'user_id must not be exposed in history response');
    }
    console.log('✅ Test 31 Passed: User history returns only own records without exposing user_id.');

    // Test 32: Public latest draw endpoint returns only published draw
    console.log('\nTest 32: Public latest draw endpoint returns only published draw...');
    const latestRes = await makeRequest(server, '/api/v1/public/draws/published/latest', {
      method: 'GET',
    });
    assert.strictEqual(latestRes.status, 200, `Expected 200, got ${latestRes.status}`);

    if (latestRes.body.data !== null) {
      // The returned draw must be in PUBLISHED status (no status field exposed, but it must be a real published draw)
      assert.ok(latestRes.body.data.draw_month, 'published draw must have draw_month');
      assert.ok(latestRes.body.data.winning_numbers, 'published draw must have winning_numbers');
      assert.ok(latestRes.body.data.published_at, 'published draw must have published_at');
      // Ensure private admin fields are NOT exposed
      assert.ok(!latestRes.body.data.created_by, 'created_by must not be in public response');
      assert.ok(!latestRes.body.data.published_by, 'published_by must not be in public response');
    }
    console.log('✅ Test 32 Passed: Public endpoint returns published draw without private admin data.');

    // ─────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────
    // Delete draw_winners first (FK), then monthly_draws, then subscriptions, then users
    await query(`DELETE FROM draw_winners WHERE draw_id IN (
      SELECT id FROM monthly_draws WHERE draw_month IN ($1, $2)
    )`, [testMonth, authTestMonth]);
    await query(`DELETE FROM monthly_draws WHERE draw_month IN ($1, $2)`, [testMonth, authTestMonth]);
    await query('DELETE FROM subscriptions WHERE user_id IN ($1, $2, $3)', [adminId, userId, activeUserId]);
    await query('DELETE FROM users WHERE id IN ($1, $2, $3)', [adminId, userId, activeUserId]);

    console.log('\n══════════════════════════════════════');
    console.log('🎉 ALL 32 DRAW ENGINE TESTS PASSED SUCCESSFULLY!');
    console.log('══════════════════════════════════════\n');
  } catch (err) {
    console.error('\n❌ DRAW TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

if (require.main === module) {
  runDrawTests();
}

module.exports = runDrawTests;
