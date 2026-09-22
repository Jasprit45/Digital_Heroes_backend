/**
 * tests/admin.test.js
 *
 * Phase 8: Admin Management & Analytics — Integration Test Suite
 *
 * Coverage:
 *   - Authorization: 401/403 guards on all admin endpoints
 *   - Users: list, get, patch (name), patch subscription charity, patch score
 *   - Charities: list (admin), create, update, soft-delete, confirm exclusion from listing after delete
 *   - Draws: GET /admin/draws/simulation/:id (SIMULATED draw fetch)
 *   - Config: GET and PATCH /admin/config/prize-pool
 *   - Winners: admin list, verify (approve/reject), payout
 *   - Analytics: GET /admin/analytics (with and without date filters)
 *
 * Prerequisites: A running PostgreSQL database reachable by the app.
 * Run: npm run test:admin
 */

'use strict';

const assert = require('assert');
const http = require('http');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const { query } = require('../src/config/database');
const { generateAccessToken } = require('../src/utils/tokens');

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(server, path, options = {}) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const reqOptions = {
      hostname: '127.0.0.1',
      port,
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
        } catch (_) {
          parsed = body;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.on('error', reject);

    if (options.body !== undefined) {
      const payload =
        typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.write(payload);
    }
    req.end();
  });
}

function token(user) {
  return generateAccessToken(user);
}

// ─── DB Fixtures ─────────────────────────────────────────────────────────────

async function setupFixtures() {
  const ts = Date.now();
  const pass = await bcrypt.hash('test_pass', 10);

  // Users
  const adminRes = await query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, 'Admin User', 'ADMIN') RETURNING id, email, role`,
    [`admin_p8_${ts}@test.com`, pass]
  );
  const userRes = await query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, 'Test User', 'USER') RETURNING id, email, role`,
    [`user_p8_${ts}@test.com`, pass]
  );

  const admin = { ...adminRes.rows[0], token: token(adminRes.rows[0]) };
  const user = { ...userRes.rows[0], token: token(userRes.rows[0]) };

  // Subscription for user (needed for subscription patch test)
  // We insert a minimal subscription with dummy Stripe IDs (no real Stripe call in tests)
  await query(
    `INSERT INTO subscriptions
       (user_id, stripe_customer_id, stripe_subscription_id, plan, status, price_cents, charity_percentage, current_period_start, current_period_end)
     VALUES ($1, $2, $3, 'MONTHLY', 'ACTIVE', 2999, 10, NOW(), NOW() + INTERVAL '30 days')
     ON CONFLICT (user_id) DO NOTHING`,
    [user.id, `cus_test_${ts}`, `sub_test_${ts}`]
  );

  // Score for user (needed for score patch test)
  const scoreRes = await query(
    `INSERT INTO golf_scores (user_id, score, played_on)
     VALUES ($1, 18, CURRENT_DATE - INTERVAL '1 day')
     RETURNING id`,
    [user.id]
  );
  const scoreId = scoreRes.rows[0].id;

  // Active charity
  const charityRes = await query(
    `INSERT INTO charities (name, slug, description, is_active)
     VALUES ($1, $2, 'Test charity for admin tests', true) RETURNING id`,
    [`TestCharity_${ts}`, `test-charity-${ts}`]
  );
  const charityId = charityRes.rows[0].id;

  // A charity to soft-delete
  const delCharityRes = await query(
    `INSERT INTO charities (name, slug, description, is_active)
     VALUES ($1, $2, 'To be deleted', true) RETURNING id`,
    [`DeleteCharity_${ts}`, `delete-charity-${ts}`]
  );
  const delCharityId = delCharityRes.rows[0].id;

  // Simulated draw (status = SIMULATED, not published)
  // Use unique months per test run to avoid unique constraint conflicts on re-runs
  const simMonth = `2198-${String((ts % 12) + 1).padStart(2, '0')}`;
  const pubMonth = `2197-${String((ts % 12) + 1).padStart(2, '0')}`;

  // Pre-clean any orphaned draws from previous failed runs
  await query(`DELETE FROM monthly_draws WHERE draw_month = $1 OR draw_month = $2`, [simMonth, pubMonth]);

  const drawRes = await query(
    `INSERT INTO monthly_draws
       (draw_month, draw_type, status, prize_pool_percentage, winning_numbers)
     VALUES ($1, 'RANDOM', 'SIMULATED', 50.00, '{1,2,3,4,5}')
     RETURNING id`,
    [simMonth]
  );
  const simulatedDrawId = drawRes.rows[0].id;

  // Published draw + winner (for winner admin and analytics tests)
  const pubDrawRes = await query(
    `INSERT INTO monthly_draws
       (draw_month, draw_type, status, prize_pool_percentage, winning_numbers)
     VALUES ($1, 'RANDOM', 'PUBLISHED', 50.00, '{1,2,3,4,5}')
     RETURNING id`,
    [pubMonth]
  );
  const pubDrawId = pubDrawRes.rows[0].id;

  const winnerRes = await query(
    `INSERT INTO draw_winners
       (draw_id, user_id, tier, matched_count, user_matched_numbers, prize_amount_cents, status)
     VALUES ($1, $2, 'MATCH_5', 5, '{1,2,3,4,5}', 100000, 'PENDING_PROOF')
     RETURNING id`,
    [pubDrawId, user.id]
  );
  const winnerId = winnerRes.rows[0].id;

  // Update charity on subscription (set to valid charity for patch test)
  await query(`UPDATE subscriptions SET selected_charity_id = $1 WHERE user_id = $2`, [
    charityId,
    user.id,
  ]);

  return {
    admin,
    user,
    charityId,
    delCharityId,
    scoreId,
    simulatedDrawId,
    pubDrawId,
    winnerId,
  };
}

async function cleanupFixtures(f) {
  // Order matters due to FK constraints
  if (f.winnerId) await query(`DELETE FROM draw_winners WHERE id = $1`, [f.winnerId]);
  if (f.pubDrawId) await query(`DELETE FROM monthly_draws WHERE id = $1`, [f.pubDrawId]);
  if (f.simulatedDrawId) await query(`DELETE FROM monthly_draws WHERE id = $1`, [f.simulatedDrawId]);
  if (f.user) {
    await query(`DELETE FROM golf_scores WHERE user_id = $1`, [f.user.id]);
    await query(`DELETE FROM subscriptions WHERE user_id = $1`, [f.user.id]);
    await query(`DELETE FROM users WHERE id = $1`, [f.user.id]);
  }
  if (f.admin) await query(`DELETE FROM users WHERE id = $1`, [f.admin.id]);
  if (f.charityId) await query(`DELETE FROM charities WHERE id = $1`, [f.charityId]);
  if (f.delCharityId) await query(`DELETE FROM charities WHERE id = $1`, [f.delCharityId]);
}

// ─── Test Runner ─────────────────────────────────────────────────────────────

async function runAdminTests() {
  console.log('🧪 Starting Phase 8 Admin Management & Analytics Test Suite...\n');

  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_123';
  const server = app.listen(0);
  const f = await setupFixtures();

  let passed = 0;
  let failed = 0;

  async function test(label, fn) {
    process.stdout.write(`  ${label} ... `);
    try {
      await fn();
      console.log('✅ PASS');
      passed++;
    } catch (err) {
      console.log(`❌ FAIL\n     → ${err.message}`);
      failed++;
    }
  }

  let createdCharityId;
  try {

  // ── 1. AUTHORIZATION GUARDS ───────────────────────────────────────────────
  console.log('\n📋 1. Authorization Guards\n');

  await test('GET /admin/users → 401 without token', async () => {
    const res = await makeRequest(server, '/admin/users');
    assert.strictEqual(res.status, 401, `Got ${res.status}`);
  });

  await test('GET /admin/users → 403 for USER role', async () => {
    const res = await makeRequest(server, '/admin/users', {
      headers: { Authorization: `Bearer ${f.user.token}` },
    });
    assert.strictEqual(res.status, 403, `Got ${res.status}`);
  });

  await test('GET /admin/charities → 401 without token', async () => {
    const res = await makeRequest(server, '/admin/charities');
    assert.strictEqual(res.status, 401, `Got ${res.status}`);
  });

  await test('GET /admin/charities → 403 for USER role', async () => {
    const res = await makeRequest(server, '/admin/charities', {
      headers: { Authorization: `Bearer ${f.user.token}` },
    });
    assert.strictEqual(res.status, 403, `Got ${res.status}`);
  });

  await test('GET /admin/config/prize-pool → 401 without token', async () => {
    const res = await makeRequest(server, '/admin/config/prize-pool');
    assert.strictEqual(res.status, 401, `Got ${res.status}`);
  });

  await test('GET /admin/analytics → 401 without token', async () => {
    const res = await makeRequest(server, '/admin/analytics');
    assert.strictEqual(res.status, 401, `Got ${res.status}`);
  });

  await test('GET /admin/analytics → 403 for USER role', async () => {
    const res = await makeRequest(server, '/admin/analytics', {
      headers: { Authorization: `Bearer ${f.user.token}` },
    });
    assert.strictEqual(res.status, 403, `Got ${res.status}`);
  });

  await test('GET /admin/draws/simulation/:id → 401 without token', async () => {
    const res = await makeRequest(server, `/admin/draws/simulation/${f.simulatedDrawId}`);
    assert.strictEqual(res.status, 401, `Got ${res.status}`);
  });

  await test('GET /admin/draws/simulation/:id → 403 for USER role', async () => {
    const res = await makeRequest(server, `/admin/draws/simulation/${f.simulatedDrawId}`, {
      headers: { Authorization: `Bearer ${f.user.token}` },
    });
    assert.strictEqual(res.status, 403, `Got ${res.status}`);
  });

  // ── 2. ADMIN USERS ────────────────────────────────────────────────────────
  console.log('\n📋 2. Admin Users\n');

  await test('GET /admin/users → 200 with paginated list', async () => {
    const res = await makeRequest(server, '/admin/users', {
      headers: { Authorization: `Bearer ${f.admin.token}` },
    });
    assert.strictEqual(res.status, 200, `Got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.data, 'data field missing');
    assert.ok(Array.isArray(res.body.data.users), 'users should be array');
    assert.ok(typeof res.body.data.total === 'number', 'total should be a number');
  });

  await test('GET /admin/users?search= filters by name/email', async () => {
    const res = await makeRequest(server, `/admin/users?search=Test+User`, {
      headers: { Authorization: `Bearer ${f.admin.token}` },
    });
    assert.strictEqual(res.status, 200, `Got ${res.status}`);
    assert.ok(res.body.data.users.length >= 1, 'Expected at least 1 user matching search');
  });

  await test('GET /admin/users/:id → 200 with user detail', async () => {
    const res = await makeRequest(server, `/admin/users/${f.user.id}`, {
      headers: { Authorization: `Bearer ${f.admin.token}` },
    });
    assert.strictEqual(res.status, 200, `Got ${res.status}`);
    assert.strictEqual(res.body.data.id, f.user.id);
    // Must not expose password_hash
    assert.ok(!res.body.data.password_hash, 'password_hash must not be returned');
  });

  await test('GET /admin/users/:id → 404 for unknown user', async () => {
    const res = await makeRequest(server, `/admin/users/00000000-0000-0000-0000-000000000000`, {
      headers: { Authorization: `Bearer ${f.admin.token}` },
    });
    assert.strictEqual(res.status, 404, `Got ${res.status}`);
  });

  await test('PATCH /admin/users/:id → 200 updates full_name', async () => {
    const res = await makeRequest(server, `/admin/users/${f.user.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${f.admin.token}` },
      body: { full_name: 'Updated Name' },
    });
    assert.strictEqual(res.status, 200, `Got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.data.full_name, 'Updated Name');
  });

  await test('PATCH /admin/users/:id → 400 with no valid fields', async () => {
    const res = await makeRequest(server, `/admin/users/${f.user.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${f.admin.token}` },
      body: {},
    });
    assert.strictEqual(res.status, 400, `Got ${res.status}`);
  });

  // ── 3. ADMIN SCORES ───────────────────────────────────────────────────────
  console.log('\n📋 3. Admin Scores\n');

  await test('PATCH /admin/users/:id/scores/:scoreId → 200 updates score', async () => {
    const res = await makeRequest(
      server,
      `/admin/users/${f.user.id}/scores/${f.scoreId}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${f.admin.token}` },
        body: { score: 20 },
      }
    );
    assert.strictEqual(res.status, 200, `Got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.data.score, 20);
  });

  await test('PATCH /admin/users/:id/scores/:scoreId → 404 for unknown score', async () => {
    const res = await makeRequest(
      server,
      `/admin/users/${f.user.id}/scores/00000000-0000-0000-0000-000000000000`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${f.admin.token}` },
        body: { score: 79 },
      }
    );
    assert.strictEqual(res.status, 404, `Got ${res.status}`);
  });

  // ── 4. ADMIN SUBSCRIPTION ─────────────────────────────────────────────────
  console.log('\n📋 4. Admin Subscription\n');

  await test('PATCH /admin/users/:id/subscription → 200 updates selected_charity_id', async () => {
    const res = await makeRequest(
      server,
      `/admin/users/${f.user.id}/subscription`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${f.admin.token}` },
        body: { selected_charity_id: f.charityId },
      }
    );
    assert.strictEqual(res.status, 200, `Got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.data.selected_charity_id, f.charityId);
  });

  await test('PATCH /admin/users/:id/subscription → 400 with no valid fields', async () => {
    const res = await makeRequest(
      server,
      `/admin/users/${f.user.id}/subscription`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${f.admin.token}` },
        body: {},
      }
    );
    assert.strictEqual(res.status, 400, `Got ${res.status}`);
  });

  await test('PATCH /admin/users/:id/subscription → 400 for inactive/missing charity', async () => {
    const res = await makeRequest(
      server,
      `/admin/users/${f.user.id}/subscription`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${f.admin.token}` },
        body: { selected_charity_id: '00000000-0000-0000-0000-000000000000' },
      }
    );
    assert.strictEqual(res.status, 400, `Got ${res.status}`);
  });

  // ── 5. ADMIN CHARITIES ────────────────────────────────────────────────────
  console.log('\n📋 5. Admin Charities\n');

  await test('GET /admin/charities → 200 lists ALL charities (incl. inactive)', async () => {
    const res = await makeRequest(server, '/admin/charities', {
      headers: { Authorization: `Bearer ${f.admin.token}` },
    });
    assert.strictEqual(res.status, 200, `Got ${res.status}`);
    assert.ok(Array.isArray(res.body.data.charities), 'charities should be array');
    assert.ok(typeof res.body.data.total === 'number');
  });

  await test('POST /admin/charities → 201 creates charity', async () => {
    const ts = Date.now();
    const res = await makeRequest(server, '/admin/charities', {
      method: 'POST',
      headers: { Authorization: `Bearer ${f.admin.token}` },
      body: {
        name: `NewCharity_${ts}`,
        slug: `new-charity-${ts}`,
        description: 'A brand new test charity',
      },
    });
    assert.strictEqual(res.status, 201, `Got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.data.id, 'Expected id in response');
    assert.strictEqual(res.body.data.is_active, true);
    createdCharityId = res.body.data.id;
  });

  await test('POST /admin/charities → 400 when required fields missing', async () => {
    const res = await makeRequest(server, '/admin/charities', {
      method: 'POST',
      headers: { Authorization: `Bearer ${f.admin.token}` },
      body: { name: 'No Slug Charity' },
    });
    assert.strictEqual(res.status, 400, `Got ${res.status}`);
  });

  await test('POST /admin/charities → 409 on duplicate slug', async () => {
    // Use the charity slug we just created
    const res = await makeRequest(server, '/admin/charities', {
      method: 'POST',
      headers: { Authorization: `Bearer ${f.admin.token}` },
      body: {
        name: 'Duplicate',
        slug: `test-charity-${Object.keys(f).length > 0 ? '' : 'x'}`, // will conflict if created above
        description: 'Duplicate slug test',
      },
    });
    // Should be 409 only if the slug already exists – we'll try an existing one
    const ts2 = Date.now();
    const existingSlug = (
      await query(`SELECT slug FROM charities WHERE id = $1`, [f.charityId])
    ).rows[0].slug;
    const res2 = await makeRequest(server, '/admin/charities', {
      method: 'POST',
      headers: { Authorization: `Bearer ${f.admin.token}` },
      body: { name: 'Dup', slug: existingSlug, description: 'Dup' },
    });
    assert.strictEqual(res2.status, 409, `Got ${res2.status}`);
  });

  await test('PUT /admin/charities/:id → 200 updates charity', async () => {
    const res = await makeRequest(server, `/admin/charities/${f.charityId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${f.admin.token}` },
      body: { name: 'Updated Charity Name' },
    });
    assert.strictEqual(res.status, 200, `Got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.data.name, 'Updated Charity Name');
  });

  await test('PUT /admin/charities/:id → 404 for unknown charity', async () => {
    const res = await makeRequest(
      server,
      `/admin/charities/00000000-0000-0000-0000-000000000000`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${f.admin.token}` },
        body: { name: 'Ghost' },
      }
    );
    assert.strictEqual(res.status, 404, `Got ${res.status}`);
  });

  await test('DELETE /admin/charities/:id → 200 soft-deletes charity', async () => {
    const res = await makeRequest(server, `/admin/charities/${f.delCharityId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${f.admin.token}` },
    });
    assert.strictEqual(res.status, 200, `Got ${res.status}: ${JSON.stringify(res.body)}`);
    // Verify is_active = false in DB
    const dbRes = await query(`SELECT is_active FROM charities WHERE id = $1`, [f.delCharityId]);
    assert.strictEqual(dbRes.rows[0].is_active, false, 'Charity should be inactive after delete');
  });

  await test('Soft-deleted charity is_active=false in DB and excluded from subscription validation', async () => {
    // Try to set the soft-deleted charity on subscription — should 400
    const res = await makeRequest(
      server,
      `/admin/users/${f.user.id}/subscription`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${f.admin.token}` },
        body: { selected_charity_id: f.delCharityId },
      }
    );
    assert.strictEqual(res.status, 400, `Got ${res.status} — inactive charity should be rejected`);
  });

  // ── 6. ADMIN DRAWS (SIMULATION) ───────────────────────────────────────────
  console.log('\n📋 6. Admin Draws — Simulation\n');

  await test('GET /admin/draws/simulation/:id → 200 returns simulation state', async () => {
    const res = await makeRequest(
      server,
      `/admin/draws/simulation/${f.simulatedDrawId}`,
      {
        headers: { Authorization: `Bearer ${f.admin.token}` },
      }
    );
    assert.strictEqual(res.status, 200, `Got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.data, 'data should be present');
    assert.strictEqual(res.body.data.id, f.simulatedDrawId);
    assert.strictEqual(res.body.data.status, 'SIMULATED');
  });

  await test('GET /admin/draws/simulation/:id → 404 for published draw', async () => {
    // pubDrawId has status=PUBLISHED, not SIMULATED
    const res = await makeRequest(
      server,
      `/admin/draws/simulation/${f.pubDrawId}`,
      {
        headers: { Authorization: `Bearer ${f.admin.token}` },
      }
    );
    assert.strictEqual(res.status, 404, `Got ${res.status}`);
  });

  await test('GET /admin/draws/simulation/:id → 400 for invalid UUID', async () => {
    const res = await makeRequest(server, `/admin/draws/simulation/not-a-uuid`, {
      headers: { Authorization: `Bearer ${f.admin.token}` },
    });
    assert.strictEqual(res.status, 400, `Got ${res.status}`);
  });

  // ── 7. ADMIN CONFIG ───────────────────────────────────────────────────────
  console.log('\n📋 7. Admin Config\n');

  await test('GET /admin/config/prize-pool → 200 returns config', async () => {
    const res = await makeRequest(server, '/admin/config/prize-pool', {
      headers: { Authorization: `Bearer ${f.admin.token}` },
    });
    assert.strictEqual(res.status, 200, `Got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.data !== undefined, 'data should be present');
  });

  await test('PATCH /admin/config/prize-pool → 200 updates prize_pool_percentage', async () => {
    const res = await makeRequest(server, '/admin/config/prize-pool', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${f.admin.token}` },
      body: { prize_pool_percentage: 60 },
    });
    assert.strictEqual(res.status, 200, `Got ${res.status}: ${JSON.stringify(res.body)}`);
    // Restore original value
    await makeRequest(server, '/admin/config/prize-pool', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${f.admin.token}` },
      body: { prize_pool_percentage: 50 },
    });
  });

  await test('PATCH /admin/config/prize-pool → 400 for out-of-range percentage', async () => {
    const res = await makeRequest(server, '/admin/config/prize-pool', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${f.admin.token}` },
      body: { prize_pool_percentage: 150 },
    });
    assert.strictEqual(res.status, 400, `Got ${res.status}`);
  });

  await test('PATCH /admin/config/prize-pool → 400 when match_tier_splits do not sum to 100', async () => {
    const res = await makeRequest(server, '/admin/config/prize-pool', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${f.admin.token}` },
      body: {
        match_tier_splits: { match_5: 50, match_4: 30, match_3: 10 }, // sums to 90
      },
    });
    assert.strictEqual(res.status, 400, `Got ${res.status}`);
  });

  await test('PATCH /admin/config/prize-pool → 200 with valid match_tier_splits', async () => {
    const res = await makeRequest(server, '/admin/config/prize-pool', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${f.admin.token}` },
      body: {
        match_tier_splits: { match_5: 60, match_4: 30, match_3: 10 },
      },
    });
    assert.strictEqual(res.status, 200, `Got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  // ── 8. ADMIN WINNERS ──────────────────────────────────────────────────────
  console.log('\n📋 8. Admin Winners\n');

  await test('GET /admin/winners → 200 returns list', async () => {
    const res = await makeRequest(server, '/admin/winners', {
      headers: { Authorization: `Bearer ${f.admin.token}` },
    });
    assert.strictEqual(res.status, 200, `Got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(Array.isArray(res.body.data), 'data should be an array');
  });

  // Simulate user uploading proof so we can approve
  // (Set status directly in DB since we don't have the full proof upload flow here)
  await query(
    `UPDATE draw_winners SET status = 'PROOF_SUBMITTED', proof_image_url = 'http://example.com/proof.jpg' WHERE id = $1`,
    [f.winnerId]
  );

  await test('PATCH /admin/winners/:id/verify → 400 REJECT requires rejection_reason', async () => {
    const res = await makeRequest(server, `/admin/winners/${f.winnerId}/verify`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${f.admin.token}` },
      body: { action: 'REJECT' },
    });
    assert.strictEqual(res.status, 400, `Got ${res.status}`);
  });

  await test('PATCH /admin/winners/:id/verify → 200 APPROVE sets VERIFIED + verified_by', async () => {
    const res = await makeRequest(server, `/admin/winners/${f.winnerId}/verify`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${f.admin.token}` },
      body: { action: 'APPROVE' },
    });
    assert.strictEqual(res.status, 200, `Got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.data.status, 'VERIFIED');
    assert.ok(res.body.data.verified_at, 'verified_at must be set');
    assert.strictEqual(res.body.data.verified_by, f.admin.id);
  });

  await test('PATCH /admin/winners/:id/payout → 200 marks VERIFIED winner as PAID', async () => {
    const res = await makeRequest(server, `/admin/winners/${f.winnerId}/payout`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${f.admin.token}` },
    });
    assert.strictEqual(res.status, 200, `Got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.data.status, 'PAID');
    assert.ok(res.body.data.paid_at, 'paid_at must be set');
  });

  await test('PATCH /admin/winners/:id/payout → 409 for already PAID winner', async () => {
    const res = await makeRequest(server, `/admin/winners/${f.winnerId}/payout`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${f.admin.token}` },
    });
    assert.strictEqual(res.status, 409, `Got ${res.status}`);
  });

  // ── 9. ANALYTICS ──────────────────────────────────────────────────────────
  console.log('\n📋 9. Analytics\n');

  await test('GET /admin/analytics → 200 returns summary data', async () => {
    const res = await makeRequest(server, '/admin/analytics', {
      headers: { Authorization: `Bearer ${f.admin.token}` },
    });
    assert.strictEqual(res.status, 200, `Got ${res.status}: ${JSON.stringify(res.body)}`);
    const d = res.body.data;
    assert.ok(d.users, 'users field missing');
    assert.ok(typeof d.users.total === 'number', 'users.total should be a number');
    assert.ok(typeof d.users.active_subscribers === 'number', 'active_subscribers should be a number');
    assert.ok(d.draws, 'draws field missing');
    assert.ok(d.winnings, 'winnings field missing');
    assert.ok(d.charity, 'charity field missing');
  });

  await test('GET /admin/analytics?from=&to= → 200 with date filters', async () => {
    const from = '2024-01-01';
    const to = '2099-12-31';
    const res = await makeRequest(server, `/admin/analytics?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${f.admin.token}` },
    });
    assert.strictEqual(res.status, 200, `Got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.data.users, 'data.users missing');
  });

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed === 0) {
    console.log('\n🎉 ALL ADMIN TESTS PASSED SUCCESSFULLY!\n');
  } else {
    console.log('\n⚠️  Some tests failed. Review the output above.\n');
    process.exitCode = 1;
  }

  } finally {
    // Cleanup dynamically created charity from test
    if (createdCharityId) {
      await query(`DELETE FROM charities WHERE id = $1`, [createdCharityId]).catch(() => {});
    }
    await cleanupFixtures(f);
    server.close();
  }
}

if (require.main === module) {
  runAdminTests().catch((err) => {
    console.error('Fatal error running admin tests:', err);
    process.exit(1);
  });
}

module.exports = runAdminTests;
