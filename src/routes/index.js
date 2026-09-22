const express = require('express');
const healthRoutes = require('../modules/health/health.routes');
const authRoutes = require('../modules/auth/auth.routes');
const subscriptionRoutes = require('../modules/subscriptions/subscription.routes');
const scoreRoutes = require('../modules/scores/score.routes');
const adminDrawRoutes = require('../modules/draws/draw.routes');
const userDrawRoutes = require('../modules/draws/userDraw.routes');
const publicDrawRoutes = require('../modules/draws/publicDraw.routes');

const router = express.Router();

// Mount health check routes
router.use('/health', healthRoutes);

// Mount authentication routes
router.use('/auth', authRoutes);

// Mount user subscription routes
router.use('/user/subscription', subscriptionRoutes);

// Mount user score routes
router.use('/user/scores', scoreRoutes);

// Mount admin draw routes (simulate + publish)
router.use('/admin/draws', adminDrawRoutes);

// Mount user draw history routes
router.use('/user/draws', userDrawRoutes);

// Mount public draw routes (no auth required)
router.use('/public/draws', publicDrawRoutes);

// Mount winner routes
const { userWinningsRouter, adminWinnersRouter } = require('../modules/winners');
router.use('/user/winnings', userWinningsRouter);
router.use('/admin/winners', adminWinnersRouter);

// Mount new admin routes
const adminUsersRouter = require('../modules/admin/users/adminUsers.routes');
const adminCharitiesRouter = require('../modules/admin/charities/adminCharities.routes');
const adminConfigRouter = require('../modules/admin/config/adminConfig.routes');
const analyticsRouter = require('../modules/admin/analytics/analytics.routes');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use('/admin/users', authenticate, requireRole('ADMIN'), adminUsersRouter);
router.use('/admin/charities', authenticate, requireRole('ADMIN'), adminCharitiesRouter);
router.use('/admin/config', authenticate, requireRole('ADMIN'), adminConfigRouter);
router.use('/admin/analytics', authenticate, requireRole('ADMIN'), analyticsRouter);

module.exports = router;
