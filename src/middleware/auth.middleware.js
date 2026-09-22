const AppError = require('../utils/appError');
const { verifyAccessToken } = require('../utils/tokens');

/**
 * Middleware to verify JWT access token in Authorization header
 */
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Authentication required. Missing Bearer token.', 401));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return next(new AppError('Access token has expired. Please refresh token.', 401));
    }
    return next(new AppError('Invalid access token.', 401));
  }
};

/**
 * Middleware factory to enforce role-based access control (RBAC)
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required.', 401));
    }

    
    if (!allowedRoles.includes(req.user.role)) {
      console.log(req.user);
      return next(new AppError('Access denied: Insufficient permissions.', 403));
    }

    next();
  };
};

module.exports = {
  authenticate,
  requireRole,
};
