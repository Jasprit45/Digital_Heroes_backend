/**
 * userDraw.routes.js
 *
 * Authenticated user draw history route.
 */

'use strict';

const express = require('express');
const drawController = require('./draw.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { requireActiveSubscription } = require('../../middleware/subscription.middleware');

const router = express.Router();

// GET /api/v1/user/draws/my-history
// Requires authenticated active subscriber
router.get('/my-history', authenticate, requireActiveSubscription, drawController.getMyHistory);

module.exports = router;
