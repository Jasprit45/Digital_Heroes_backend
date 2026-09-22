const rateLimit = require('express-rate-limit');

// Strict rate limiter for authentication endpoints (prevent brute force)
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 auth requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'fail',
    message: 'Too many authentication attempts from this IP. Please try again after 15 minutes.',
  },
});

module.exports = {
  authRateLimiter,
};
