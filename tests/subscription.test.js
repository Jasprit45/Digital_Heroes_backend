// Ensure test Stripe env vars are defined before requiring app
process.env.STRIPE_MONTHLY_PRICE_ID = process.env.STRIPE_MONTHLY_PRICE_ID || 'price_test_monthly_123';
process.env.STRIPE_YEARLY_PRICE_ID = process.env.STRIPE_YEARLY_PRICE_ID || 'price_test_yearly_456';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret_789';

const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const { query } = require('../src/config/database');
const { generateAccessToken } = require('../src/utils/tokens');
const stripe = require('../src/config/stripe');

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
      if (options.rawBody) {
        req.write(options.body);
      } else {
        req.write(JSON.stringify(options.body));
      }
    }
    req.end();
  });
}

async function runSubscriptionTests() {
  console.log('🧪 Starting Phase 3 Subscription & Stripe Integration Test Suite...\n');

  const server = app.listen(0);

  // Setup test users in DB
  const testUserEmail = `subuser_${Date.now()}@example.com`;
  const adminUserEmail = `adminuser_${Date.now()}@example.com`;

  let userId = null;
  let userToken = null;

  try {
    // Insert test user
    const userRes = await query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ($1, $2, 'hash123', 'USER')
       RETURNING id, email, role`,
      ['Sub Test User', testUserEmail]
    );
    userId = userRes.rows[0].id;
    userToken = generateAccessToken(userRes.rows[0]);

    // Insert dummy charity for charity validation tests
    const charityRes = await query(
      `INSERT INTO charities (name, slug, description)
       VALUES ('Test Cancer Charity', 'test-cancer-charity-${Date.now()}', 'Supporting cancer research')
       RETURNING id`
    );
    const validCharityId = charityRes.rows[0].id;
    const nonExistentCharityId = '00000000-0000-0000-0000-000000000000';

    // ----------------------------------------------------
    // Test 1: User with no subscription (GET /api/v1/user/subscription/status)
    // ----------------------------------------------------
    console.log('Test 1: GET status for user with no subscription...');
    const noSubRes = await makeRequest(server, '/api/v1/user/subscription/status', {
      method: 'GET',
      headers: { Authorization: `Bearer ${userToken}` },
    });

    assert.strictEqual(noSubRes.status, 200, `Expected 200 OK, got ${noSubRes.status}`);
    assert.strictEqual(noSubRes.body.data.status, 'INACTIVE');
    assert.strictEqual(noSubRes.body.data.plan, null);
    console.log('✅ Test 1 Passed: Returns INACTIVE status for unsubscribed user.');

    // ----------------------------------------------------
    // Test 2: Checkout request validation - Invalid plan
    // ----------------------------------------------------
    console.log('\nTest 2: Reject checkout with invalid plan (WEEKLY)...');
    const invalidPlanRes = await makeRequest(server, '/api/v1/user/subscription/checkout-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
      body: { plan: 'WEEKLY', charity_percentage: 15 },
    });

    assert.strictEqual(invalidPlanRes.status, 400, `Expected 400 Bad Request, got ${invalidPlanRes.status}`);
    console.log('✅ Test 2 Passed: Invalid plan correctly rejected.');

    // ----------------------------------------------------
    // Test 3: Checkout request validation - Charity % < 10
    // ----------------------------------------------------
    console.log('\nTest 3: Reject checkout with charity percentage < 10%...');
    const lowPctRes = await makeRequest(server, '/api/v1/user/subscription/checkout-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
      body: { plan: 'MONTHLY', charity_percentage: 5 },
    });

    assert.strictEqual(lowPctRes.status, 400, `Expected 400 Bad Request, got ${lowPctRes.status}`);
    console.log('✅ Test 3 Passed: Charity percentage below 10% rejected.');

    // ----------------------------------------------------
    // Test 4: Checkout request validation - Charity % > 100
    // ----------------------------------------------------
    console.log('\nTest 4: Reject checkout with charity percentage > 100%...');
    const highPctRes = await makeRequest(server, '/api/v1/user/subscription/checkout-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
      body: { plan: 'MONTHLY', charity_percentage: 120 },
    });

    assert.strictEqual(highPctRes.status, 400, `Expected 400 Bad Request, got ${highPctRes.status}`);
    console.log('✅ Test 4 Passed: Charity percentage above 100% rejected.');

    // ----------------------------------------------------
    // Test 5: Checkout request validation - Non-existent charity
    // ----------------------------------------------------
    console.log('\nTest 5: Reject checkout with non-existent charity ID...');
    const invalidCharityRes = await makeRequest(server, '/api/v1/user/subscription/checkout-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
      body: { plan: 'MONTHLY', selected_charity_id: nonExistentCharityId, charity_percentage: 20 },
    });

    assert.strictEqual(invalidCharityRes.status, 400, `Expected 400 Bad Request, got ${invalidCharityRes.status}`);
    console.log('✅ Test 5 Passed: Non-existent charity ID rejected with 400.');

    // ----------------------------------------------------
    // Test 6 & 7: Mock Stripe API for Checkout Sessions (MONTHLY & YEARLY)
    // ----------------------------------------------------
    console.log('\nTest 6 & 7: Checkout Session creation (MONTHLY & YEARLY)...');
    
    // Mock stripe customer & checkout creation for testing
    const originalCustomerCreate = stripe.customers.create;
    const originalCheckoutCreate = stripe.checkout.sessions.create;

    stripe.customers.create = async () => ({ id: 'cus_test_123' });
    stripe.checkout.sessions.create = async (params) => ({
      id: `cs_test_${params.metadata.plan.toLowerCase()}_123`,
      url: `https://checkout.stripe.com/pay/cs_test_${params.metadata.plan.toLowerCase()}`,
    });

    const monthlyCheckout = await makeRequest(server, '/api/v1/user/subscription/checkout-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
      body: { plan: 'MONTHLY', selected_charity_id: validCharityId, charity_percentage: 15 },
    });

    assert.strictEqual(monthlyCheckout.status, 200);
    assert.ok(monthlyCheckout.body.data.sessionId);
    assert.ok(monthlyCheckout.body.data.url);
    console.log('✅ Test 6 Passed: MONTHLY checkout session created successfully.');

    const yearlyCheckout = await makeRequest(server, '/api/v1/user/subscription/checkout-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
      body: { plan: 'YEARLY', selected_charity_id: validCharityId, charity_percentage: 20 },
    });

    assert.strictEqual(yearlyCheckout.status, 200);
    assert.ok(yearlyCheckout.body.data.sessionId);
    console.log('✅ Test 7 Passed: YEARLY checkout session created successfully.');

    // Restore Stripe mocks
    stripe.customers.create = originalCustomerCreate;
    stripe.checkout.sessions.create = originalCheckoutCreate;

    // ----------------------------------------------------
    // Test 8: Webhook Signature Verification - Reject Invalid Signature
    // ----------------------------------------------------
    console.log('\nTest 8: Webhook signature verification check...');
    const invalidSigWebhook = await makeRequest(server, '/api/v1/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'invalid_signature_string' },
      body: JSON.stringify({ id: 'evt_test_1', type: 'payment_intent.succeeded' }),
      rawBody: true,
    });

    assert.strictEqual(invalidSigWebhook.status, 400, `Expected 400 Bad Request for bad signature, got ${invalidSigWebhook.status}`);
    console.log('✅ Test 8 Passed: Unverified Stripe webhook rejected with 400.');

    // ----------------------------------------------------
    // Test 9, 10, 11, 12: Stripe Webhook Lifecycle Handling (Idempotency & State Updates)
    // ----------------------------------------------------
    console.log('\nTest 9: Process checkout.session.completed webhook...');
    
    // Mock stripe.subscriptions.retrieve for webhook handler
    const originalSubRetrieve = stripe.subscriptions.retrieve;
    const nowSec = Math.floor(Date.now() / 1000);
    const thirtyDaysSec = nowSec + 30 * 24 * 60 * 60;

    stripe.subscriptions.retrieve = async (subId) => ({
      id: subId,
      items: { data: [{ price: { unit_amount: 2999 } }] },
      current_period_start: nowSec,
      current_period_end: thirtyDaysSec,
      cancel_at_period_end: false,
    });

    // Mock webhooks.constructEvent to test event handler
    const originalConstructEvent = stripe.webhooks.constructEvent;
    
    const mockCheckoutEvent = {
      id: `evt_checkout_${Date.now()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_test_123',
          subscription: 'sub_test_999',
          metadata: {
            user_id: userId,
            plan: 'MONTHLY',
            selected_charity_id: validCharityId,
            charity_percentage: '15.0',
          },
        },
      },
    };

    stripe.webhooks.constructEvent = () => mockCheckoutEvent;

    const completedWebhook = await makeRequest(server, '/api/v1/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid_mock_signature' },
      body: JSON.stringify(mockCheckoutEvent),
      rawBody: true,
    });

    assert.strictEqual(completedWebhook.status, 200);
    assert.strictEqual(completedWebhook.body.received, true);

    // Verify DB updated status to ACTIVE
    const activeStatusRes = await makeRequest(server, '/api/v1/user/subscription/status', {
      method: 'GET',
      headers: { Authorization: `Bearer ${userToken}` },
    });

    assert.strictEqual(activeStatusRes.body.data.status, 'ACTIVE');
    assert.strictEqual(activeStatusRes.body.data.plan, 'MONTHLY');
    assert.strictEqual(activeStatusRes.body.data.price_cents, 2999);
    console.log('✅ Test 9 Passed: checkout.session.completed updated subscription to ACTIVE in PostgreSQL.');

    // ----------------------------------------------------
    // Test 10: Idempotent Webhook Event Duplicate Handling
    // ----------------------------------------------------
    console.log('\nTest 10: Duplicate webhook event idempotency check...');
    const duplicateWebhook = await makeRequest(server, '/api/v1/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid_mock_signature' },
      body: JSON.stringify(mockCheckoutEvent),
      rawBody: true,
    });

    assert.strictEqual(duplicateWebhook.status, 200);
    assert.strictEqual(duplicateWebhook.body.message, 'Event already processed');
    console.log('✅ Test 10 Passed: Duplicate webhook event recognized and ignored gracefully.');

    // ----------------------------------------------------
    // Test 11: invoice.payment_failed sets status = PAST_DUE
    // ----------------------------------------------------
    console.log('\nTest 11: invoice.payment_failed webhook...');
    const mockFailedEvent = {
      id: `evt_failed_${Date.now()}`,
      type: 'invoice.payment_failed',
      data: {
        object: {
          subscription: 'sub_test_999',
        },
      },
    };

    stripe.webhooks.constructEvent = () => mockFailedEvent;

    const failedWebhook = await makeRequest(server, '/api/v1/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid_mock_signature' },
      body: JSON.stringify(mockFailedEvent),
      rawBody: true,
    });

    assert.strictEqual(failedWebhook.status, 200);

    const pastDueStatusRes = await makeRequest(server, '/api/v1/user/subscription/status', {
      method: 'GET',
      headers: { Authorization: `Bearer ${userToken}` },
    });

    assert.strictEqual(pastDueStatusRes.body.data.status, 'PAST_DUE');
    console.log('✅ Test 11 Passed: invoice.payment_failed updated status to PAST_DUE.');

    // ----------------------------------------------------
    // Test 12: customer.subscription.deleted sets status = CANCELLED
    // ----------------------------------------------------
    console.log('\nTest 12: customer.subscription.deleted webhook...');
    const mockDeletedEvent = {
      id: `evt_deleted_${Date.now()}`,
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_test_999',
        },
      },
    };

    stripe.webhooks.constructEvent = () => mockDeletedEvent;

    const deletedWebhook = await makeRequest(server, '/api/v1/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid_mock_signature' },
      body: JSON.stringify(mockDeletedEvent),
      rawBody: true,
    });

    assert.strictEqual(deletedWebhook.status, 200);

    const cancelledStatusRes = await makeRequest(server, '/api/v1/user/subscription/status', {
      method: 'GET',
      headers: { Authorization: `Bearer ${userToken}` },
    });

    assert.strictEqual(cancelledStatusRes.body.data.status, 'CANCELLED');
    console.log('✅ Test 12 Passed: customer.subscription.deleted updated status to CANCELLED.');

    // Restore Stripe constructEvent & retrieve mocks
    stripe.webhooks.constructEvent = originalConstructEvent;
    stripe.subscriptions.retrieve = originalSubRetrieve;

    // ----------------------------------------------------
    // Test 13 & 14: requireActiveSubscription middleware enforcement
    // ----------------------------------------------------
    console.log('\nTest 13 & 14: requireActiveSubscription middleware tests...');
    const { requireActiveSubscription } = require('../src/middleware/subscription.middleware');

    // Test 13: Inactive user blocked (403)
    const reqInactive = { user: { id: userId } };
    let errorPassedInactive = null;
    await requireActiveSubscription(reqInactive, {}, (err) => { errorPassedInactive = err; });

    assert.ok(errorPassedInactive, 'Middleware must pass error for inactive user');
    assert.strictEqual(errorPassedInactive.statusCode, 403);
    assert.strictEqual(errorPassedInactive.message, 'Active subscription required to access this feature');
    console.log('✅ Test 13 Passed: requireActiveSubscription rejects CANCELLED/INACTIVE user with 403.');

    // Manually activate sub in DB to test active user allowed
    await query(
      `UPDATE subscriptions SET status = 'ACTIVE', current_period_end = NOW() + INTERVAL '10 days' WHERE user_id = $1`,
      [userId]
    );

    // Test 14: Active user allowed (next called without error)
    const reqActive = { user: { id: userId } };
    let errorPassedActive = null;
    let nextCalled = false;
    await requireActiveSubscription(reqActive, {}, (err) => {
      if (err) errorPassedActive = err;
      else nextCalled = true;
    });

    assert.strictEqual(errorPassedActive, null);
    assert.strictEqual(nextCalled, true);
    assert.ok(reqActive.subscription);
    console.log('✅ Test 14 Passed: requireActiveSubscription allows ACTIVE user with valid period.');

    // ----------------------------------------------------
    // Cleanup Test Data from DB
    // ----------------------------------------------------
    await query('DELETE FROM subscriptions WHERE user_id = $1', [userId]);
    await query('DELETE FROM charities WHERE id = $1', [validCharityId]);
    await query('DELETE FROM users WHERE id = $1', [userId]);

    console.log('\n🎉 ALL SUBSCRIPTION & STRIPE INTEGRATION TESTS PASSED SUCCESSFULLY!\n');
  } catch (err) {
    console.error('\n❌ SUBSCRIPTION TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

if (require.main === module) {
  runSubscriptionTests();
}

module.exports = runSubscriptionTests;
