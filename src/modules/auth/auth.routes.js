const express = require('express');
const authController = require('./auth.controller');
const { registerSchema, loginSchema } = require('./auth.validation');
const validate = require('../../middleware/validate.middleware');
const { authRateLimiter } = require('../../middleware/rateLimit.middleware');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');

const router = express.Router();

router.post('/register', authRateLimiter, validate(registerSchema), authController.register);
router.post('/login', authRateLimiter, validate(loginSchema), authController.login);
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authController.logout);

// Protected test endpoint for testing requireRole('ADMIN')
router.get('/admin-only', authenticate, requireRole('ADMIN'), (req, res) => {
  res.json({ success: true, message: 'Welcome Admin!' });
});

module.exports = router;
