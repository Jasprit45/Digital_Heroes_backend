const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const { query } = require('../src/config/database');

// Helper to make HTTP requests against local Express test server instance
function makeRequest(server, path, options = {}) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const reqOptions = {
      hostname: '127.0.0.1',
      port: port,
      path: `/api/v1/auth${path}`,
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
        
        // Extract Set-Cookie header if present
        const setCookie = res.headers['set-cookie'];
        
        resolve({
          status: res.statusCode,
          headers: res.headers,
          setCookie: setCookie,
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

async function runAuthTests() {
  console.log('🧪 Starting Phase 2 Authentication & Authorization Test Suite...\n');
  
  // Start server on dynamic port
  const server = app.listen(0);
  
  const testEmail = `testuser_${Date.now()}@example.com`;
  const testPassword = 'SecurePassword123!';
  const testName = 'Test User';
  
  let userAccessToken = null;
  let refreshTokenCookie = null;

  try {
    // ----------------------------------------------------
    // Test 1: Successful registration
    // ----------------------------------------------------
    console.log('Test 1: Register new user...');
    const regRes = await makeRequest(server, '/register', {
      method: 'POST',
      body: {
        full_name: testName,
        email: testEmail,
        password: testPassword,
      },
    });

    assert.strictEqual(regRes.status, 201, `Expected 201 Created, got ${regRes.status}`);
    assert.strictEqual(regRes.body.success, true);
    assert.strictEqual(regRes.body.data.user.email, testEmail);
    assert.strictEqual(regRes.body.data.user.role, 'USER');
    assert.strictEqual(regRes.body.data.user.password_hash, undefined, 'password_hash must never be returned');
    console.log('✅ Test 1 Passed: User registered successfully.');

    // ----------------------------------------------------
    // Test 2: Duplicate registration (HTTP 409)
    // ----------------------------------------------------
    console.log('\nTest 2: Duplicate registration check...');
    const dupRes = await makeRequest(server, '/register', {
      method: 'POST',
      body: {
        full_name: testName,
        email: testEmail,
        password: testPassword,
      },
    });

    assert.strictEqual(dupRes.status, 409, `Expected 409 Conflict, got ${dupRes.status}`);
    assert.strictEqual(dupRes.body.status, 'fail');
    console.log('✅ Test 2 Passed: Duplicate registration correctly rejected with 409.');

    // ----------------------------------------------------
    // Test 3: Wrong password login (HTTP 401)
    // ----------------------------------------------------
    console.log('\nTest 3: Wrong password login check...');
    const wrongPassRes = await makeRequest(server, '/login', {
      method: 'POST',
      body: {
        email: testEmail,
        password: 'WrongPassword999!',
      },
    });

    assert.strictEqual(wrongPassRes.status, 401, `Expected 401 Unauthorized, got ${wrongPassRes.status}`);
    assert.strictEqual(wrongPassRes.body.message, 'Invalid email or password.');
    console.log('✅ Test 3 Passed: Wrong password rejected with 401.');

    // ----------------------------------------------------
    // Test 4: Successful login
    // ----------------------------------------------------
    console.log('\nTest 4: Successful login...');
    const loginRes = await makeRequest(server, '/login', {
      method: 'POST',
      body: {
        email: testEmail,
        password: testPassword,
      },
    });

    assert.strictEqual(loginRes.status, 200, `Expected 200 OK, got ${loginRes.status}`);
    assert.strictEqual(loginRes.body.success, true);
    assert.ok(loginRes.body.data.accessToken, 'Access token should be present');
    assert.ok(loginRes.setCookie, 'HttpOnly cookie set-cookie header should be present');
    
    // Save state for subsequent tests
    userAccessToken = loginRes.body.data.accessToken;
    refreshTokenCookie = loginRes.setCookie[0].split(';')[0]; // refreshToken=xxx
    console.log('✅ Test 4 Passed: Login successful, access token and HttpOnly cookie issued.');

    // ----------------------------------------------------
    // Test 5: Refresh token rotation
    // ----------------------------------------------------
    console.log('\nTest 5: Refresh token rotation...');
    const oldCookie = refreshTokenCookie;
    const refreshRes = await makeRequest(server, '/refresh-token', {
      method: 'POST',
      headers: {
        Cookie: oldCookie,
      },
    });

    assert.strictEqual(refreshRes.status, 200, `Expected 200 OK, got ${refreshRes.status}`);
    assert.strictEqual(refreshRes.body.success, true);
    assert.ok(refreshRes.body.data.accessToken, 'New access token should be issued');
    assert.ok(refreshRes.setCookie, 'New refresh token cookie should be set');
    
    const newCookie = refreshRes.setCookie[0].split(';')[0];
    assert.notStrictEqual(oldCookie, newCookie, 'Old and new refresh token cookies must be different');
    
    userAccessToken = refreshRes.body.data.accessToken;
    console.log('✅ Test 5 Passed: Refresh token rotated successfully.');

    // ----------------------------------------------------
    // Test 6: Reusing revoked refresh token (HTTP 401)
    // ----------------------------------------------------
    console.log('\nTest 6: Revoked refresh token reuse check...');
    const reuseRes = await makeRequest(server, '/refresh-token', {
      method: 'POST',
      headers: {
        Cookie: oldCookie, // Reusing old rotated cookie
      },
    });

    assert.strictEqual(reuseRes.status, 401, `Expected 401 Unauthorized for revoked token, got ${reuseRes.status}`);
    console.log('✅ Test 6 Passed: Revoked refresh token reuse correctly rejected with 401.');

    // ----------------------------------------------------
    // Test 7: Invalid access token check (HTTP 401)
    // ----------------------------------------------------
    console.log('\nTest 7: Invalid access token check...');
    const invalidAuthRes = await makeRequest(server, '/admin-only', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer invalid_garbage_token_123',
      },
    });

    assert.strictEqual(invalidAuthRes.status, 401, `Expected 401 Unauthorized, got ${invalidAuthRes.status}`);
    console.log('✅ Test 7 Passed: Invalid access token rejected with 401.');

    // ----------------------------------------------------
    // Test 8: USER accessing ADMIN route (HTTP 403)
    // ----------------------------------------------------
    console.log('\nTest 8: USER role accessing ADMIN route check...');
    const adminForbiddenRes = await makeRequest(server, '/admin-only', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
      },
    });

    assert.strictEqual(adminForbiddenRes.status, 403, `Expected 403 Forbidden, got ${adminForbiddenRes.status}`);
    assert.strictEqual(adminForbiddenRes.body.message, 'Access denied: Insufficient permissions.');
    console.log('✅ Test 8 Passed: USER forbidden from ADMIN endpoint with 403.');

    // ----------------------------------------------------
    // Test 9: Logout session revocation
    // ----------------------------------------------------
    console.log('\nTest 9: Logout session revocation...');
    const logoutRes = await makeRequest(server, '/logout', {
      method: 'POST',
      headers: {
        Cookie: newCookie,
      },
    });

    assert.strictEqual(logoutRes.status, 200, `Expected 200 OK, got ${logoutRes.status}`);
    assert.strictEqual(logoutRes.body.success, true);

    // Verify token is now revoked
    const postLogoutRefresh = await makeRequest(server, '/refresh-token', {
      method: 'POST',
      headers: {
        Cookie: newCookie,
      },
    });
    assert.strictEqual(postLogoutRefresh.status, 401, 'Logged out token must be rejected');
    console.log('✅ Test 9 Passed: User logged out and session revoked successfully.');

    // ----------------------------------------------------
    // Cleanup Test User Data from DB
    // ----------------------------------------------------
    await query('DELETE FROM users WHERE email = $1', [testEmail]);

    console.log('\n🎉 ALL AUTHENTICATION & AUTHORIZATION TESTS PASSED SUCCESSFULLY!\n');
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

if (require.main === module) {
  runAuthTests();
}

module.exports = runAuthTests;
