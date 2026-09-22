const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_change_in_production_12345';
const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';

/**
 * Generate short-lived JWT access token (15-minute default)
 */
const generateAccessToken = (payload) => {
  return jwt.sign(
    {
      id: payload.id,
      email: payload.email,
      role: payload.role,
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
};

/**
 * Verify JWT access token
 */
const verifyAccessToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

/**
 * Generate cryptographically secure random raw refresh token string
 */
const generateRefreshTokenString = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Hash raw refresh token string using SHA-256 for secure DB storage
 */
const hashRefreshToken = (rawToken) => {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
};

module.exports = {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshTokenString,
  hashRefreshToken,
};
