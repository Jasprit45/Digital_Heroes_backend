const { query } = require('../../../config/database');

class AnalyticsService {
  async getAnalytics(startDate, endDate) {
    const params = [];
    let dateFilter = '';
    
    if (startDate && endDate) {
      dateFilter = `WHERE created_at >= $1 AND created_at <= $2`;
      params.push(startDate, endDate);
    } else if (startDate) {
      dateFilter = `WHERE created_at >= $1`;
      params.push(startDate);
    } else if (endDate) {
      dateFilter = `WHERE created_at <= $1`;
      params.push(endDate);
    }

    // 1. Total Users
    const usersRes = await query(`SELECT count(*) FROM users ${dateFilter}`, params);
    const totalUsers = parseInt(usersRes.rows[0].count, 10);

    // 2. Active Subscribers (Current state, not bound by created_at date filter unless requested by PRD, but normally it's a current metric)
    const activeSubSql = `
      SELECT count(*) FROM subscriptions 
      WHERE status = 'ACTIVE' AND current_period_end > NOW()
    `;
    const activeSubRes = await query(activeSubSql);
    const activeSubscribers = parseInt(activeSubRes.rows[0].count, 10);

    // 3. Total Prize Pool (from published monthly_draws)
    let drawParams = [];
    let drawDateFilter = '';
    if (startDate && endDate) {
      drawDateFilter = `AND published_at >= $1 AND published_at <= $2`;
      drawParams.push(startDate, endDate);
    }
    
    const prizePoolSql = `
      SELECT 
        count(*) as total_published_draws,
        COALESCE(SUM(gross_pool_cents), 0) as total_gross_pool_cents,
        COALESCE(SUM(pool_match_5_cents + pool_match_4_cents + pool_match_3_cents), 0) as total_allocated_prize_cents
      FROM monthly_draws 
      WHERE status = 'PUBLISHED' ${drawDateFilter}
    `;
    const prizePoolRes = await query(prizePoolSql, drawParams);
    
    // 4. Paid Winnings
    let winnerParams = [];
    let winnerDateFilter = '';
    if (startDate && endDate) {
      winnerDateFilter = `AND paid_at >= $1 AND paid_at <= $2`;
      winnerParams.push(startDate, endDate);
    }
    
    const winningsSql = `
      SELECT 
        count(*) as total_paid_winners,
        COALESCE(SUM(prize_amount_cents), 0) as total_paid_cents
      FROM draw_winners
      WHERE status = 'PAID' ${winnerDateFilter}
    `;
    const winningsRes = await query(winningsSql, winnerParams);
    
    // 5. Charity Totals (from charity_donations)
    // Note: To get subscription charity totals, we would need an audit or transaction log of payments. 
    // For this scope, charity_donations represents the stored charity donation records.
    let donationParams = [];
    let donationDateFilter = '';
    if (startDate && endDate) {
      donationDateFilter = `WHERE created_at >= $1 AND created_at <= $2`;
      donationParams.push(startDate, endDate);
    }
    
    const charitySql = `
      SELECT COALESCE(SUM(amount_cents), 0) as total_donated_cents
      FROM charity_donations
      ${donationDateFilter}
    `;
    const charityRes = await query(charitySql, donationParams);

    return {
      users: {
        total: totalUsers,
        active_subscribers: activeSubscribers
      },
      draws: {
        published_count: parseInt(prizePoolRes.rows[0].total_published_draws, 10),
        total_gross_pool_cents: parseInt(prizePoolRes.rows[0].total_gross_pool_cents, 10),
        total_allocated_prize_cents: parseInt(prizePoolRes.rows[0].total_allocated_prize_cents, 10)
      },
      winnings: {
        total_paid_winners: parseInt(winningsRes.rows[0].total_paid_winners, 10),
        total_paid_cents: parseInt(winningsRes.rows[0].total_paid_cents, 10)
      },
      charity: {
        total_donated_cents: parseInt(charityRes.rows[0].total_donated_cents, 10)
      }
    };
  }
}

module.exports = new AnalyticsService();
