const { query, getClient } = require('../../config/database');
const AppError = require('../../utils/appError');

class ScoreService {
  /**
   * Get latest 5 scores for user in reverse chronological order
   */
  async getUserScores(userId) {
    const res = await query(
      `SELECT id, score, to_char(played_on, 'YYYY-MM-DD') AS played_on, created_at, updated_at
       FROM golf_scores
       WHERE user_id = $1
       ORDER BY played_on DESC, created_at DESC
       LIMIT 5`,
      [userId]
    );

    return res.rows;
  }

  /**
   * Add a new score with transactional rolling-5 pruning & concurrency lock
   */
  async addScore(userId, { score, played_on }) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // 1. Transaction Advisory Lock for user's score operations (concurrency protection)
      const lockKey = `golf_scores_${userId}`;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

      // 2. Check for duplicate score date
      const dupCheck = await client.query(
        'SELECT id FROM golf_scores WHERE user_id = $1 AND played_on = $2',
        [userId, played_on]
      );

      if (dupCheck.rows.length > 0) {
        throw new AppError('A score entry already exists for this date. Duplicate scores for the same date are not allowed.', 409);
      }

      // 3. Insert new score
      await client.query(
        `INSERT INTO golf_scores (user_id, score, played_on)
         VALUES ($1, $2, $3)`,
        [userId, score, played_on]
      );

      // 4. Prune older scores beyond the 5 latest
      await client.query(
        `DELETE FROM golf_scores
         WHERE id IN (
           SELECT id FROM golf_scores
           WHERE user_id = $1
           ORDER BY played_on DESC, created_at DESC
           OFFSET 5
         )`,
        [userId]
      );

      // 5. Fetch updated top 5 scores
      const finalScoresRes = await client.query(
        `SELECT id, score, to_char(played_on, 'YYYY-MM-DD') AS played_on, created_at, updated_at
         FROM golf_scores
         WHERE user_id = $1
         ORDER BY played_on DESC, created_at DESC`,
        [userId]
      );

      await client.query('COMMIT');
      return finalScoresRes.rows;
    } catch (error) {
      await client.query('ROLLBACK');
      
      // Handle PostgreSQL unique constraint error code 23505 if triggered
      if (error.code === '23505') {
        throw new AppError('A score entry already exists for this date. Duplicate scores for the same date are not allowed.', 409);
      }
      
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update an existing score owned by user
   */
  async updateScore(userId, scoreId, { score, played_on }) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Lock user's score row
      const existingRes = await client.query(
        `SELECT id, score, to_char(played_on, 'YYYY-MM-DD') AS played_on
         FROM golf_scores
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
        [scoreId, userId]
      );

      if (existingRes.rows.length === 0) {
        throw new AppError('Score not found or you do not have permission to edit it.', 404);
      }

      const existingScore = existingRes.rows[0];
      const newPlayedOn = played_on || existingScore.played_on;

      // Check if new played_on conflicts with another score owned by user
      if (played_on && played_on !== existingScore.played_on) {
        const dupCheck = await client.query(
          'SELECT id FROM golf_scores WHERE user_id = $1 AND played_on = $2 AND id != $3',
          [userId, played_on, scoreId]
        );

        if (dupCheck.rows.length > 0) {
          throw new AppError('A score entry already exists for this date. Duplicate scores for the same date are not allowed.', 409);
        }
      }

      const newScoreValue = score !== undefined ? score : existingScore.score;

      const updateRes = await client.query(
        `UPDATE golf_scores
         SET score = $1, played_on = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND user_id = $4
         RETURNING id, score, to_char(played_on, 'YYYY-MM-DD') AS played_on, created_at, updated_at`,
        [newScoreValue, newPlayedOn, scoreId, userId]
      );

      await client.query('COMMIT');
      return updateRes.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      
      if (error.code === '23505') {
        throw new AppError('A score entry already exists for this date. Duplicate scores for the same date are not allowed.', 409);
      }

      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete a score entry owned by user
   */
  async deleteScore(userId, scoreId) {
    const delRes = await query(
      'DELETE FROM golf_scores WHERE id = $1 AND user_id = $2 RETURNING id',
      [scoreId, userId]
    );

    if (delRes.rows.length === 0) {
      throw new AppError('Score not found or you do not have permission to delete it.', 404);
    }

    return { message: 'Score deleted successfully.' };
  }
}

module.exports = new ScoreService();
