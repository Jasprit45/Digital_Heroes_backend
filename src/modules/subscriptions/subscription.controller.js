const subscriptionService = require('./subscription.service');

class SubscriptionController {
  /**
   * POST /api/v1/user/subscription/checkout-session
   */
  async createCheckoutSession(req, res, next) {
    try {
      const userId = req.user.id;
      const result = await subscriptionService.createCheckoutSession(userId, req.body);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/user/subscription/status
   */
  async getStatus(req, res, next) {
    try {
      const userId = req.user.id;
      const subscription = await subscriptionService.getSubscriptionStatus(userId);

      res.status(200).json({
        success: true,
        data: subscription,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new SubscriptionController();
