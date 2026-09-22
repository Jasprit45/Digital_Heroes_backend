const express = require('express');
const analyticsController = require('./analytics.controller');

const router = express.Router();

router.get('/', analyticsController.getAnalytics);

module.exports = router;
