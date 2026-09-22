const { query } = require('../config/database');
const AppError = require('../utils/appError');

/**
 * Middleware enforcing active database subscription check for protected gameplay features.
 * Does NOT read subscription status from JWT claims — PostgreSQL is authoritative.
 */
const requireActiveSubscription = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return next(new AppError('Authentication required.', 401));
    }

    const subRes = await query(
      `SELECT status, current_period_end
       FROM subscriptions
       WHERE user_id = $1`,
      [req.user.id]
    );

    if (subRes.rows.length === 0) {
      return next(new AppError('Active subscription required to access this feature', 403));
    }

    const sub = subRes.rows[0];
    const isPeriodValid = sub.current_period_end && new Date(sub.current_period_end) > new Date();

    if (sub.status !== 'ACTIVE' || !isPeriodValid) {
      return next(new AppError('Active subscription required to access this feature', 403));
    }

    req.subscription = sub;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  requireActiveSubscription,
};
