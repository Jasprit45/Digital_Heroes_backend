const healthService = require('./health.service');

class HealthController {
  async getHealth(req, res, next) {
    try {
      const healthInfo = await healthService.getHealthStatus();
      const statusCode = healthInfo.status === 'OK' ? 200 : 503;

      res.status(statusCode).json({
        success: healthInfo.status === 'OK',
        data: healthInfo,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new HealthController();
