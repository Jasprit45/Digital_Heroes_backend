const { query } = require('../../../config/database');
const AppError = require('../../../utils/appError');
const scoreService = require('../../scores/score.service');

class AdminUsersService {
  async listUsers({ page = 1, limit = 20, search, role, status }) {
    const offset = (page - 1) * limit;
    
    let sql = `
      SELECT 
        u.id, u.full_name, u.email, u.role, u.created_at,
        s.status AS subscription_status, s.plan, s.current_period_end
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (search) {
      sql += ` AND (u.full_name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    if (role) {
      sql += ` AND u.role = $${paramIndex++}`;
      params.push(role);
    }
    
    if (status) {
      sql += ` AND s.status = $${paramIndex++}`;
      params.push(status);
    }
    
    sql += ` ORDER BY u.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    
    const countSql = `SELECT count(*) FROM users`;
    
    const [result, countResult] = await Promise.all([
      query(sql, params),
      query(countSql)
    ]);
    
    return {
      users: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit
    };
  }

  async getUser(id) {
    const userSql = `
      SELECT id, full_name, email, role, created_at 
      FROM users WHERE id = $1
    `;
    const userRes = await query(userSql, [id]);
    
    if (userRes.rows.length === 0) {
      throw new AppError('User not found', 404);
    }
    
    const subSql = `
      SELECT id, plan, status, current_period_end, selected_charity_id 
      FROM subscriptions WHERE user_id = $1
    `;
    const subRes = await query(subSql, [id]);
    
    return {
      ...userRes.rows[0],
      subscription: subRes.rows.length ? subRes.rows[0] : null
    };
  }

  async updateUser(id, data) {
    if (!data.full_name) {
      throw new AppError('No valid fields provided for update', 400);
    }
    
    const sql = `
      UPDATE users 
      SET full_name = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, full_name, email, role, created_at
    `;
    
    const res = await query(sql, [data.full_name, id]);
    if (res.rows.length === 0) {
      throw new AppError('User not found', 404);
    }
    return res.rows[0];
  }

  async updateSubscription(id, data) {
    const { selected_charity_id } = data;
    
    if (!selected_charity_id) {
      throw new AppError('No valid subscription fields provided for update', 400);
    }
    
    // Validate charity exists and is active
    const charityRes = await query('SELECT id FROM charities WHERE id = $1 AND is_active = true', [selected_charity_id]);
    if (charityRes.rows.length === 0) {
      throw new AppError('Selected charity does not exist or is inactive.', 400);
    }
    
    const sql = `
      UPDATE subscriptions 
      SET selected_charity_id = $1, updated_at = NOW()
      WHERE user_id = $2
      RETURNING id, plan, status, current_period_end, selected_charity_id
    `;
    
    const res = await query(sql, [selected_charity_id, id]);
    if (res.rows.length === 0) {
      throw new AppError('User does not have an active subscription', 404);
    }
    return res.rows[0];
  }

  async updateScore(userId, scoreId, data) {
    return await scoreService.updateScore(userId, scoreId, data);
  }
}

module.exports = new AdminUsersService();
