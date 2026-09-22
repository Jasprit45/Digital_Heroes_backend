/**
 * draw.routes.js
 *
 * Admin draw routes.
 * All endpoints require ADMIN authentication.
 */

'use strict';

const express = require('express');
const drawController = require('./draw.controller');
const { simulateDrawSchema, drawIdParamSchema } = require('./draw.validation');
const validate = require('../../middleware/validate.middleware');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');

const router = express.Router();

// All admin draw routes require authentication + ADMIN role
router.use(authenticate, requireRole('ADMIN'));

// POST /api/v1/admin/draws/simulate
router.post('/simulate', validate(simulateDrawSchema), drawController.simulate);

// GET /api/v1/admin/draws/simulation/:id
router.get('/simulation/:id', validate(drawIdParamSchema), drawController.getSimulation);

// POST /api/v1/admin/draws/:id/publish
router.post('/:id/publish', validate(drawIdParamSchema), drawController.publish);

module.exports = router;
