const express = require('express');
const adminConfigController = require('./adminConfig.controller');

const router = express.Router();

router.get('/prize-pool', adminConfigController.getPrizePoolConfig);
router.patch('/prize-pool', adminConfigController.updatePrizePoolConfig);

module.exports = router;
