const express = require('express');
const subscriptionController = require('./subscription.controller');
const { createCheckoutSessionSchema } = require('./subscription.validation');
const validate = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

router.post(
  '/checkout-session',
  authenticate,
  validate(createCheckoutSessionSchema),
  subscriptionController.createCheckoutSession
);

router.get(
  '/status',
  authenticate,
  subscriptionController.getStatus
);

module.exports = router;
