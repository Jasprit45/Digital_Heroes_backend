const bcrypt = require('bcryptjs');
const { query, getClient } = require('../../config/database');
const AppError = require('../../utils/appError');
const {
  generateAccessToken,
  generateRefreshTokenString,
  hashRefreshToken,
} = require('../../utils/tokens');

class AuthService {
  /**
   * Register a new user
   */
  async register({ full_name, email, password }) {
    const normalizedEmail = email.toLowerCase().trim();

    // Check if email already registered
    const existingUserRes = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existingUserRes.rows.length > 0) {
      throw new AppError('An account with this email address already exists.', 409);
    }

    // Hash password
    const saltRounds = 12;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Insert new user with default role 'USER'
    const insertRes = await query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ($1, $2, $3, 'USER')
       RETURNING id, full_name, email, role, created_at`,
      [full_name.trim(), normalizedEmail, password_hash]
    );

    return insertRes.rows[0];
  }

  /**
   * Login user and issue access + refresh tokens
   */
  async login({ email, password }) {
    const normalizedEmail = email.toLowerCase().trim();

    // Fetch user
    const userRes = await query(
      'SELECT id, full_name, email, password_hash, role FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (userRes.rows.length === 0) {
      throw new AppError('Invalid email or password.', 401);
    }

    const user = userRes.rows[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw new AppError('Invalid email or password.', 401);
    }

    // Generate Access Token (15m)
    const accessToken = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    // Generate Refresh Token
    const rawRefreshToken = generateRefreshTokenString();
    const tokenHash = hashRefreshToken(rawRefreshToken);

    const refreshTokenDays = parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || '7', 10);
    const expiresAt = new Date(Date.now() + refreshTokenDays * 24 * 60 * 60 * 1000);

    // Persist hashed refresh token in database
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    return {
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
      },
      accessToken,
      rawRefreshToken,
    };
  }

  /**
   * Rotate refresh token and issue new access token atomically
   */
  async refreshToken(rawRefreshToken) {
    if (!rawRefreshToken) {
      throw new AppError('Refresh token missing from cookie.', 401);
    }

    const tokenHash = hashRefreshToken(rawRefreshToken);
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Fetch active session with user details and FOR UPDATE lock
      const sessionRes = await client.query(
        `SELECT rt.id AS token_id, rt.user_id, rt.expires_at, rt.is_revoked,
                u.email, u.full_name, u.role
         FROM refresh_tokens rt
         JOIN users u ON rt.user_id = u.id
         WHERE rt.token_hash = $1
         FOR UPDATE`,
        [tokenHash]
      );

      if (sessionRes.rows.length === 0) {
        throw new AppError('Invalid refresh token.', 401);
      }

      const session = sessionRes.rows[0];

      if (session.is_revoked) {
        throw new AppError('Refresh token has been revoked.', 401);
      }

      if (new Date(session.expires_at) < new Date()) {
        throw new AppError('Refresh token has expired.', 401);
      }

      // 1. Revoke the current refresh token
      await client.query(
        'UPDATE refresh_tokens SET is_revoked = TRUE WHERE id = $1',
        [session.token_id]
      );

      // 2. Issue new raw refresh token and insert hash
      const newRawRefreshToken = generateRefreshTokenString();
      const newTokenHash = hashRefreshToken(newRawRefreshToken);

      const refreshTokenDays = parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || '7', 10);
      const newExpiresAt = new Date(Date.now() + refreshTokenDays * 24 * 60 * 60 * 1000);

      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [session.user_id, newTokenHash, newExpiresAt]
      );

      // 3. Issue new access token
      const accessToken = generateAccessToken({
        id: session.user_id,
        email: session.email,
        role: session.role,
      });

      await client.query('COMMIT');

      return {
        user: {
          id: session.user_id,
          full_name: session.full_name,
          email: session.email,
          role: session.role,
        },
        accessToken,
        rawRefreshToken: newRawRefreshToken,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Revoke refresh token session on logout
   */
  async logout(rawRefreshToken) {
    if (!rawRefreshToken) {
      return true; // Idempotent
    }

    const tokenHash = hashRefreshToken(rawRefreshToken);
    await query(
      'UPDATE refresh_tokens SET is_revoked = TRUE WHERE token_hash = $1',
      [tokenHash]
    );

    return true;
  }
}

module.exports = new AuthService();
