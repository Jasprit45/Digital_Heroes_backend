/**
 * publicDraw.routes.js
 *
 * Public draw endpoints — no authentication required.
 * Returns only non-sensitive, publicly visible draw information.
 */

'use strict';

const express = require('express');
const drawController = require('./draw.controller');

const router = express.Router();

// GET /api/v1/public/draws/published/latest
// Returns the most recent published draw (no private user data)
router.get('/published/latest', drawController.getLatestPublished);

module.exports = router;
