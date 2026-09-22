const { query, getClient } = require('../../../config/database');
const AppError = require('../../../utils/appError');

class AdminConfigService {
  async getPrizePoolConfig() {
    const sql = `SELECT key, value, description FROM system_configs WHERE key IN ('prize_pool_percentage', 'match_tier_splits')`;
    const res = await query(sql);
    
    const config = {};
    for (const row of res.rows) {
      config[row.key] = row.value;
    }
    
    return config;
  }

  async updatePrizePoolConfig({ prize_pool_percentage, match_tier_splits }) {
    if (prize_pool_percentage !== undefined) {
      const percentage = parseFloat(prize_pool_percentage);
      if (isNaN(percentage) || percentage < 0 || percentage > 100) {
        throw new AppError('prize_pool_percentage must be a number between 0 and 100', 400);
      }
    }
    
    if (match_tier_splits !== undefined) {
      if (typeof match_tier_splits !== 'object') {
        throw new AppError('match_tier_splits must be an object', 400);
      }
      
      const { match_5, match_4, match_3 } = match_tier_splits;
      if (match_5 === undefined || match_4 === undefined || match_3 === undefined) {
        throw new AppError('match_tier_splits must contain match_5, match_4, and match_3', 400);
      }
      
      const total = parseFloat(match_5) + parseFloat(match_4) + parseFloat(match_3);
      if (Math.abs(total - 100) > 0.01) { // Floating point precision check
        throw new AppError('The sum of match_tier_splits must equal 100', 400);
      }
    }
    
    const client = await getClient();
    try {
      await client.query('BEGIN');
      
      if (prize_pool_percentage !== undefined) {
        await client.query(`
          UPDATE system_configs 
          SET value = $1::jsonb, updated_at = NOW() 
          WHERE key = 'prize_pool_percentage'
        `, [JSON.stringify(parseFloat(prize_pool_percentage))]);
      }
      
      if (match_tier_splits !== undefined) {
        await client.query(`
          UPDATE system_configs 
          SET value = $1::jsonb, updated_at = NOW() 
          WHERE key = 'match_tier_splits'
        `, [JSON.stringify(match_tier_splits)]);
      }
      
      await client.query('COMMIT');
      return await this.getPrizePoolConfig();
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = new AdminConfigService();
