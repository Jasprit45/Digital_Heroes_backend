const { query } = require('../../../config/database');
const AppError = require('../../../utils/appError');

class AdminCharitiesService {
  async listCharities({ page = 1, limit = 20 }) {
    const offset = (page - 1) * limit;
    
    const sql = `
      SELECT id, name, slug, description, logo_url, banner_url, is_featured, events, is_active, created_at, updated_at
      FROM charities
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;
    
    const countSql = `SELECT count(*) FROM charities`;
    
    const [result, countResult] = await Promise.all([
      query(sql, [limit, offset]),
      query(countSql)
    ]);
    
    return {
      charities: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit
    };
  }

  async createCharity(data) {
    const { name, slug, description, logo_url, banner_url, is_featured, events } = data;
    
    if (!name || !slug || !description) {
      throw new AppError('Name, slug, and description are required', 400);
    }
    
    try {
      const sql = `
        INSERT INTO charities (name, slug, description, logo_url, banner_url, is_featured, events)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      const values = [name, slug, description, logo_url || null, banner_url || null, !!is_featured, events ? JSON.stringify(events) : '[]'];
      
      const res = await query(sql, values);
      return res.rows[0];
    } catch (err) {
      if (err.code === '23505') { // Unique constraint violation
        throw new AppError('A charity with this slug already exists', 409);
      }
      throw err;
    }
  }

  async updateCharity(id, data) {
    // Only update fields provided
    const fields = [];
    const values = [];
    let paramIndex = 1;
    
    const allowedFields = ['name', 'slug', 'description', 'logo_url', 'banner_url', 'is_featured', 'events', 'is_active'];
    
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        fields.push(`${field} = $${paramIndex++}`);
        if (field === 'events') {
          values.push(JSON.stringify(data[field]));
        } else {
          values.push(data[field]);
        }
      }
    }
    
    if (fields.length === 0) {
      throw new AppError('No valid fields provided for update', 400);
    }
    
    fields.push(`updated_at = NOW()`);
    values.push(id);
    
    const sql = `
      UPDATE charities
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    
    try {
      const res = await query(sql, values);
      if (res.rows.length === 0) {
        throw new AppError('Charity not found', 404);
      }
      return res.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        throw new AppError('A charity with this slug already exists', 409);
      }
      throw err;
    }
  }

  async softDeleteCharity(id) {
    const sql = `
      UPDATE charities
      SET is_active = false, updated_at = NOW()
      WHERE id = $1
      RETURNING id, is_active
    `;
    const res = await query(sql, [id]);
    
    if (res.rows.length === 0) {
      throw new AppError('Charity not found', 404);
    }
    
    return { message: 'Charity has been soft deleted successfully.' };
  }
}

module.exports = new AdminCharitiesService();
