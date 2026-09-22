const stripe = require('../../config/stripe');
const subscriptionService = require('./subscription.service');
const AppError = require('../../utils/appError');

class WebhookController {
  /**
   * POST /api/v1/webhooks/stripe
   * Uses raw Buffer body to verify Stripe signature.
   */
  async handleStripeWebhook(req, res, next) {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_placeholder_for_development';

    let event;

    try {
      if (!sig) {
        throw new Error('Missing stripe-signature header.');
      }
      
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      return next(new AppError(`Webhook Error: ${err.message}`, 400));
    }

    try {
      const result = await subscriptionService.handleWebhookEvent(event);
      
      if (result && result.duplicate) {
        return res.status(200).json({ received: true, message: 'Event already processed' });
      }

      res.status(200).json({ received: true });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new WebhookController();
