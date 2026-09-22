const { testConnection } = require('../../config/database');

class HealthService {
  /**
   * Performs system health check including DB pool verification
   */
  async getHealthStatus() {
    const dbStatus = await testConnection();

    return {
      status: dbStatus.success ? 'OK' : 'DEGRADED',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      database: {
        connected: dbStatus.success,
        ...(dbStatus.success ? { dbTimestamp: dbStatus.timestamp } : { error: dbStatus.error }),
      },
    };
  }
}

module.exports = new HealthService();
