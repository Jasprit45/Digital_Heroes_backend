const express = require('express');
const scoreController = require('./score.controller');
const {
  addScoreSchema,
  updateScoreSchema,
  scoreIdParamSchema,
} = require('./score.validation');
const validate = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');
const { requireActiveSubscription } = require('../../middleware/subscription.middleware');

const router = express.Router();

// Apply authentication and active subscription requirement to all score routes
router.use(authenticate, requireActiveSubscription);

router.get('/', scoreController.getScores);
router.post('/', validate(addScoreSchema), scoreController.addScore);
router.put('/:id', validate(updateScoreSchema), scoreController.updateScore);
router.delete('/:id', validate(scoreIdParamSchema), scoreController.deleteScore);

module.exports = router;
