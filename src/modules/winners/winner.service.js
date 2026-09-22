const { query, getClient } = require('../../config/database');
const { supabase } = require('../../config/supabase');
const crypto = require('crypto');
const path = require('path');
const AppError = require('../../utils/appError');

class WinnerService {
  /**
   * Fetch all winnings for a specific user.
   */
  static async getUserWinnings(userId) {
    const sql = `
      SELECT 
        dw.id,
        dw.tier,
        dw.matched_count,
        dw.user_matched_numbers AS matched_numbers,
        dw.prize_amount_cents,
        dw.status,
        dw.proof_image_url,
        dw.rejection_reason,
        dw.verified_at,
        dw.paid_at,
        md.id AS draw_id,
        md.draw_month
      FROM draw_winners dw
      JOIN monthly_draws md ON dw.draw_id = md.id
      WHERE dw.user_id = $1
      ORDER BY md.created_at DESC
    `;
    const result = await query(sql, [userId]);
    
    // Format the response according to PRD
    return result.rows.map(row => ({
      id: row.id,
      draw: {
        id: row.draw_id,
        month: row.draw_month
      },
      tier: row.tier,
      matched_count: row.matched_count,
      matched_numbers: row.matched_numbers,
      prize_amount_cents: row.prize_amount_cents,
      status: row.status,
      proof_image_url: row.proof_image_url,
      rejection_reason: row.rejection_reason,
      verified_at: row.verified_at,
      paid_at: row.paid_at
    }));
  }

  /**
   * Upload proof for a specific winner record.
   */
  static async uploadProof(userId, winnerId, fileBuffer, mimeType, originalName) {
    const winnerSql = `SELECT * FROM draw_winners WHERE id = $1`;
    const winnerResult = await query(winnerSql, [winnerId]);
    
    if (winnerResult.rows.length === 0) {
      throw new AppError('Winner record not found', 404);
    }
    
    const winner = winnerResult.rows[0];
    
    if (winner.user_id !== userId) {
      throw new AppError('Unauthorized access to winner record', 403);
    }
    
    if (winner.status !== 'PENDING_PROOF' && winner.status !== 'REJECTED') {
      throw new AppError(`Cannot submit proof when status is ${winner.status}`, 409);
    }
    
    let proofImageUrl = null;
    
    // Supabase upload logic
    if (supabase) {
      const ext = path.extname(originalName) || '.jpeg';
      const filename = `${winnerId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      const bucket = 'winner-proofs';
      
      const { data, error } = await supabase
        .storage
        .from(bucket)
        .upload(filename, fileBuffer, {
          contentType: mimeType,
          upsert: false
        });
        
      if (error) {
        console.error('Supabase upload error:', error);
        throw new Error('Failed to upload proof image');
      }
      
      proofImageUrl = `${bucket}/${filename}`;
    } else {
      // Mock for local testing without supabase configured
      proofImageUrl = `mock-storage/${winnerId}-${Date.now()}${path.extname(originalName)}`;
    }
    
    // Update state to PROOF_SUBMITTED
    const updateSql = `
      UPDATE draw_winners 
      SET 
        status = 'PROOF_SUBMITTED',
        proof_image_url = $1,
        rejection_reason = NULL
      WHERE id = $2
      RETURNING *
    `;
    const updateResult = await query(updateSql, [proofImageUrl, winnerId]);
    
    return updateResult.rows[0];
  }

  /**
   * Fetch all winners for admin view.
   */
  static async getAdminWinners(filters = {}) {
    let sql = `
      SELECT 
        dw.id,
        dw.tier,
        dw.matched_count,
        dw.prize_amount_cents,
        dw.status,
        dw.proof_image_url,
        dw.rejection_reason,
        dw.verified_at,
        dw.paid_at,
        dw.created_at AS submission_date,
        md.id AS draw_id,
        md.draw_month,
        u.id AS user_id,
        u.email,
        u.full_name
      FROM draw_winners dw
      JOIN monthly_draws md ON dw.draw_id = md.id
      JOIN users u ON dw.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (filters.status) {
      sql += ` AND dw.status = $${paramIndex++}`;
      params.push(filters.status);
    }
    
    if (filters.draw_month) {
      sql += ` AND md.draw_month = $${paramIndex++}`;
      params.push(filters.draw_month);
    }
    
    if (filters.tier) {
      sql += ` AND dw.tier = $${paramIndex++}`;
      params.push(filters.tier);
    }
    
    sql += ` ORDER BY dw.created_at DESC`;
    
    const result = await query(sql, params);
    
    return result.rows.map(row => ({
      id: row.id,
      user: {
        id: row.user_id,
        email: row.email,
        full_name: row.full_name
      },
      draw: {
        id: row.draw_id,
        month: row.draw_month
      },
      tier: row.tier,
      matched_count: row.matched_count,
      prize_amount_cents: row.prize_amount_cents,
      status: row.status,
      has_proof: !!row.proof_image_url,
      submission_date: row.submission_date,
      verified_at: row.verified_at,
      paid_at: row.paid_at
    }));
  }

  /**
   * Generates a signed URL for a specific winner's proof image.
   */
  static async generateProofUrl(winnerId) {
    const winnerSql = `SELECT proof_image_url FROM draw_winners WHERE id = $1`;
    const winnerResult = await query(winnerSql, [winnerId]);
    
    if (winnerResult.rows.length === 0) {
      throw new AppError('Winner record not found', 404);
    }
    
    const { proof_image_url } = winnerResult.rows[0];
    if (!proof_image_url) {
      throw new AppError('No proof image uploaded', 404);
    }
    
    if (!supabase) {
      return { url: `https://mock-storage.local/${proof_image_url}` };
    }
    
    const parts = proof_image_url.split('/');
    const bucket = parts[0];
    const path = parts.slice(1).join('/');
    
    const { data, error } = await supabase
      .storage
      .from(bucket)
      .createSignedUrl(path, 3600); // 1 hour expiry
      
    if (error) {
      throw new Error('Failed to generate signed URL');
    }
    
    return { url: data.signedUrl };
  }

  /**
   * Admin verify action (APPROVE or REJECT).
   */
  static async verifyWinner(adminId, winnerId, action, rejectionReason) {
    if (action !== 'APPROVE' && action !== 'REJECT') {
      throw new AppError('Invalid verification action. Must be APPROVE or REJECT.', 400);
    }
    
    if (action === 'REJECT' && !rejectionReason) {
      throw new AppError('Rejection reason is required when rejecting a proof.', 400);
    }
    
    const client = await getClient();
    try {
      await client.query('BEGIN');
      
      const lockSql = `SELECT * FROM draw_winners WHERE id = $1 FOR UPDATE`;
      const lockResult = await client.query(lockSql, [winnerId]);
      
      if (lockResult.rows.length === 0) {
        throw new AppError('Winner record not found', 404);
      }
      
      const winner = lockResult.rows[0];
      
      if (winner.status !== 'PROOF_SUBMITTED') {
        throw new AppError(`Cannot verify winner in ${winner.status} state. Only PROOF_SUBMITTED is allowed.`, 409);
      }
      
      let updateSql;
      let params;
      
      if (action === 'APPROVE') {
        updateSql = `
          UPDATE draw_winners 
          SET status = 'VERIFIED', verified_at = NOW(), verified_by = $1
          WHERE id = $2 RETURNING *
        `;
        params = [adminId, winnerId];
      } else {
        updateSql = `
          UPDATE draw_winners 
          SET status = 'REJECTED', rejection_reason = $1, verified_at = NULL, verified_by = $2
          WHERE id = $3 RETURNING *
        `;
        params = [rejectionReason, adminId, winnerId];
      }
      
      const updateResult = await client.query(updateSql, params);
      
      await client.query('COMMIT');
      return updateResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Admin payout tracking.
   */
  static async payWinner(adminId, winnerId) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      
      const lockSql = `SELECT * FROM draw_winners WHERE id = $1 FOR UPDATE`;
      const lockResult = await client.query(lockSql, [winnerId]);
      
      if (lockResult.rows.length === 0) {
        throw new AppError('Winner record not found', 404);
      }
      
      const winner = lockResult.rows[0];
      
      if (winner.status === 'PAID') {
        throw new AppError('Winner has already been marked as PAID.', 409);
      }
      
      if (winner.status !== 'VERIFIED') {
        throw new AppError(`Cannot pay winner in ${winner.status} state. Only VERIFIED winners can be paid.`, 409);
      }
      
      const updateSql = `
        UPDATE draw_winners 
        SET status = 'PAID', paid_at = NOW()
        WHERE id = $1 RETURNING *
      `;
      const updateResult = await client.query(updateSql, [winnerId]);
      
      await client.query('COMMIT');
      return updateResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = WinnerService;
