/**
 * draw.service.js
 *
 * Orchestration service for the draw engine.
 * Handles simulation, publishing, user history, and public draw queries.
 *
 * Design rules:
 *  - Prize pool percentage is read from system_configs (never hardcoded).
 *  - Tier split percentages are read from system_configs.
 *  - All monetary values are stored/computed as integer cents.
 *  - Publishing is atomic (BEGIN/COMMIT/ROLLBACK).
 *  - Simulation results are only visible to admins until published.
 *  - Winner records are created ONLY during publish, never during simulate.
 *  - A PUBLISHED draw cannot be re-simulated or re-published.
 *  - A SIMULATED draw can be re-simulated (the row is replaced).
 */

'use strict';

const { query, getClient } = require('../../config/database');
const AppError = require('../../utils/appError');
const {
  generateRandomWinningNumbers,
  buildScoreFrequencyHistogram,
  generateWeightedWinningNumbers,
  calculateMatchCount,
  getMatchTier,
  calculatePrizePool,
  calculateTierPools,
  splitPrizeAmongWinners,
} = require('./draw.engine');

class DrawService {
  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Load a required system config value from the database.
   * Throws a 500 AppError if the key is missing.
   *
   * @param {object} client - pg client
   * @param {string} key
   * @returns {*} Parsed JSONB value
   */
  async _loadSystemConfig(client, key) {
    const res = await client.query(
      'SELECT value FROM system_configs WHERE key = $1',
      [key]
    );
    if (res.rows.length === 0) {
      throw new AppError(`System configuration missing for key: ${key}`, 500);
    }
    return res.rows[0].value;
  }

  /**
   * Find the rollover amount from the most recent published draw that is
   * strictly BEFORE the target draw month.
   *
   * @param {object} client
   * @param {string} drawMonth - 'YYYY-MM'
   * @returns {number} rollover cents (0 if none found)
   */
  async _getPreviousRollover(client, drawMonth) {
    const res = await client.query(
      `SELECT rollover_to_next_cents
       FROM monthly_draws
       WHERE status = 'PUBLISHED'
         AND draw_month < $1
       ORDER BY draw_month DESC
       LIMIT 1`,
      [drawMonth]
    );
    return res.rows.length > 0 ? (res.rows[0].rollover_to_next_cents || 0) : 0;
  }

  /**
   * Fetch all active subscribers with price_cents.
   * A subscriber is active when:
   *   status = 'ACTIVE' AND current_period_end > NOW()
   *
   * @param {object} client
   * @returns {Array<{user_id: string, price_cents: number}>}
   */
  async _getActiveSubscribers(client) {
    const res = await client.query(
      `SELECT user_id, price_cents
       FROM subscriptions
       WHERE status = 'ACTIVE'
         AND current_period_end > NOW()`
    );
    return res.rows;
  }

  /**
   * Fetch the latest 5 scores for each user in the given set of user IDs.
   * Returns a Map of user_id -> number[]
   *
   * @param {object} client
   * @param {string[]} userIds
   * @returns {Map<string, number[]>}
   */
  async _fetchSubscriberScores(client, userIds) {
    if (userIds.length === 0) return new Map();

    const res = await client.query(
      `SELECT DISTINCT ON (user_id) user_id,
              array_agg(score ORDER BY played_on DESC, created_at DESC) AS scores
       FROM (
         SELECT user_id, score, played_on, created_at,
                ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY played_on DESC, created_at DESC) AS rn
         FROM golf_scores
         WHERE user_id = ANY($1::uuid[])
       ) ranked
       WHERE rn <= 5
       GROUP BY user_id`,
      [userIds]
    );

    const scoreMap = new Map();
    for (const row of res.rows) {
      scoreMap.set(row.user_id, row.scores || []);
    }

    return scoreMap;
  }

  /**
   * Run the full matching engine across all active subscribers.
   *
   * @param {Array<{user_id: string}>} activeSubscribers
   * @param {Map<string, number[]>} scoreMap
   * @param {number[]} winningNumbers
   * @returns {{ match5: Array, match4: Array, match3: Array }}
   */
  _runMatchingEngine(activeSubscribers, scoreMap, winningNumbers) {
    const match5 = [];
    const match4 = [];
    const match3 = [];

    for (const sub of activeSubscribers) {
      const userScores = scoreMap.get(sub.user_id) || [];
      if (userScores.length === 0) continue; // No scores → no participation

      const { matchedCount, matchedNumbers } = calculateMatchCount(userScores, winningNumbers);
      const tier = getMatchTier(matchedCount);

      if (!tier) continue;

      const winnerEntry = {
        user_id: sub.user_id,
        matched_count: matchedCount,
        matched_numbers: matchedNumbers,
        tier,
      };

      if (tier === 'MATCH_5') match5.push(winnerEntry);
      else if (tier === 'MATCH_4') match4.push(winnerEntry);
      else if (tier === 'MATCH_3') match3.push(winnerEntry);
    }

    return { match5, match4, match3 };
  }

  /**
   * Calculate per-tier prize amounts and overall rollover.
   *
   * Strategy: remainders are NOT given to winners.
   *   MATCH_5 remainder → added to rollover_to_next_cents
   *   MATCH_4 remainder → Charity Contribution Fund (tracked but not in DB yet)
   *   MATCH_3 remainder → Charity Contribution Fund (tracked but not in DB yet)
   *
   * @param {{ match5: Array, match4: Array, match3: Array }} winnerGroups
   * @param {{ match5Cents: number, match4Cents: number, match3Cents: number }} tierPools
   * @returns {{ prizePerWinner: {match5, match4, match3}, rolloverToNextCents: number }}
   */
  _calculateWinnerPrizes(winnerGroups, tierPools) {
    // MATCH_5
    let rolloverToNextCents = 0;
    let match5PrizePerWinner = 0;

    if (winnerGroups.match5.length === 0) {
      // No MATCH_5 winners → entire MATCH_5 pool rolls over
      rolloverToNextCents = tierPools.match5Cents;
      match5PrizePerWinner = 0;
    } else {
      const { prizePerWinnerCents, remainderCents } = splitPrizeAmongWinners(
        tierPools.match5Cents,
        winnerGroups.match5.length
      );
      match5PrizePerWinner = prizePerWinnerCents;
      // Remainder from MATCH_5 split → also rolls over to next month
      rolloverToNextCents = remainderCents;
    }

    // MATCH_4
    const { prizePerWinnerCents: match4PrizePerWinner } = splitPrizeAmongWinners(
      tierPools.match4Cents,
      winnerGroups.match4.length
    );

    // MATCH_3
    const { prizePerWinnerCents: match3PrizePerWinner } = splitPrizeAmongWinners(
      tierPools.match3Cents,
      winnerGroups.match3.length
    );

    return {
      prizePerWinner: {
        match5: match5PrizePerWinner,
        match4: match4PrizePerWinner,
        match3: match3PrizePerWinner,
      },
      rolloverToNextCents,
    };
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Simulate a monthly draw.
   *
   * Creates (or replaces) a SIMULATED draw row. Does NOT create draw_winners records.
   * Returns a complete preview for admin review.
   *
   * @param {string} adminUserId
   * @param {{ month: string, type: 'RANDOM' | 'ALGORITHMIC' }} params
   */
  async simulateDraw(adminUserId, { month, type }) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // 1. Check for an existing draw for this month
      const existingRes = await client.query(
        `SELECT id, status FROM monthly_draws WHERE draw_month = $1 FOR UPDATE`,
        [month]
      );

      if (existingRes.rows.length > 0) {
        const existing = existingRes.rows[0];
        if (existing.status === 'PUBLISHED') {
          throw new AppError(
            `A draw for ${month} has already been published and cannot be re-simulated.`,
            409
          );
        }
        // If SIMULATED or DRAFT: delete it and re-simulate from scratch
        await client.query('DELETE FROM monthly_draws WHERE id = $1', [existing.id]);
      }

      // 2. Load configuration from system_configs
      const poolPctRaw = await this._loadSystemConfig(client, 'prize_pool_percentage');
      const tierSplitsRaw = await this._loadSystemConfig(client, 'match_tier_splits');

      const prizePoolPercentage = parseFloat(poolPctRaw);
      const tierSplits = {
        match_5: parseFloat(tierSplitsRaw.match_5),
        match_4: parseFloat(tierSplitsRaw.match_4),
        match_3: parseFloat(tierSplitsRaw.match_3),
      };

      // 3. Load previous month's rollover
      const rolloverFromPreviousCents = await this._getPreviousRollover(client, month);

      // 4. Fetch active subscribers
      const activeSubscribers = await this._getActiveSubscribers(client);
      const activeSubscriberCount = activeSubscribers.length;

      // 5. Generate winning numbers
      let winningNumbers;
      if (type === 'RANDOM') {
        winningNumbers = generateRandomWinningNumbers();
      } else {
        // ALGORITHMIC: build histogram from all active subscriber scores
        const userIds = activeSubscribers.map((s) => s.user_id);
        const scoreMap = await this._fetchSubscriberScores(client, userIds);

        // Flatten all scores into a single array for histogram
        const allScores = [];
        for (const scores of scoreMap.values()) {
          for (const s of scores) {
            allScores.push({ score: s });
          }
        }

        const histogram = buildScoreFrequencyHistogram(allScores);
        winningNumbers = generateWeightedWinningNumbers(histogram);
      }

      // 6. Fetch latest 5 scores for each subscriber (for matching)
      const userIds = activeSubscribers.map((s) => s.user_id);
      const scoreMap = await this._fetchSubscriberScores(client, userIds);

      // 7. Run matching engine
      const winnerGroups = this._runMatchingEngine(activeSubscribers, scoreMap, winningNumbers);

      // 8. Calculate prize pool
      const grossPoolCents = calculatePrizePool(activeSubscribers, prizePoolPercentage);

      // 9. Calculate tier pools
      const tierPools = calculateTierPools(grossPoolCents, rolloverFromPreviousCents, tierSplits);

      // 10. Calculate per-winner amounts and rollover
      const { prizePerWinner, rolloverToNextCents } = this._calculateWinnerPrizes(
        winnerGroups,
        tierPools
      );

      // 11. Persist SIMULATED draw
      const insertRes = await client.query(
        `INSERT INTO monthly_draws (
           draw_month, draw_type, status, winning_numbers,
           prize_pool_percentage, total_active_subscribers,
           gross_pool_cents,
           pool_match_5_cents, pool_match_4_cents, pool_match_3_cents,
           rollover_from_previous_cents, rollover_to_next_cents,
           simulated_at, created_by
         ) VALUES (
           $1, $2, 'SIMULATED', $3,
           $4, $5,
           $6,
           $7, $8, $9,
           $10, $11,
           NOW(), $12
         )
         RETURNING id, draw_month, draw_type, status, winning_numbers,
                   prize_pool_percentage, total_active_subscribers,
                   gross_pool_cents,
                   pool_match_5_cents, pool_match_4_cents, pool_match_3_cents,
                   rollover_from_previous_cents, rollover_to_next_cents,
                   simulated_at, created_by`,
        [
          month,
          type,
          winningNumbers,
          prizePoolPercentage,
          activeSubscriberCount,
          grossPoolCents,
          tierPools.match5Cents,
          tierPools.match4Cents,
          tierPools.match3Cents,
          rolloverFromPreviousCents,
          rolloverToNextCents,
          adminUserId,
        ]
      );

      await client.query('COMMIT');

      const draw = insertRes.rows[0];

      // Return simulation preview (no winner records created yet)
      return {
        draw_id: draw.id,
        month: draw.draw_month,
        type: draw.draw_type,
        status: draw.status,
        winning_numbers: draw.winning_numbers,
        active_subscriber_count: draw.total_active_subscribers,
        prize_pool_percentage: parseFloat(draw.prize_pool_percentage),
        gross_pool_cents: draw.gross_pool_cents,
        rollover_from_previous_cents: draw.rollover_from_previous_cents,
        pool_match_5_cents: draw.pool_match_5_cents,
        pool_match_4_cents: draw.pool_match_4_cents,
        pool_match_3_cents: draw.pool_match_3_cents,
        winner_counts: {
          match_5: winnerGroups.match5.length,
          match_4: winnerGroups.match4.length,
          match_3: winnerGroups.match3.length,
        },
        prize_per_winner_cents: {
          match_5: prizePerWinner.match5,
          match_4: prizePerWinner.match4,
          match_3: prizePerWinner.match3,
        },
        rollover_to_next_cents: draw.rollover_to_next_cents,
        simulated_at: draw.simulated_at,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Publish a previously simulated draw.
   *
   * Atomically transitions SIMULATED → PUBLISHED and creates official draw_winners records.
   *
   * @param {string} adminUserId
   * @param {string} drawId - UUID of the draw to publish
   */
  async publishDraw(adminUserId, drawId) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // 1. Lock and verify the draw row
      const drawRes = await client.query(
        `SELECT id, status, draw_month, draw_type, winning_numbers,
                gross_pool_cents, prize_pool_percentage,
                pool_match_5_cents, pool_match_4_cents, pool_match_3_cents,
                rollover_from_previous_cents, rollover_to_next_cents,
                total_active_subscribers
         FROM monthly_draws
         WHERE id = $1
         FOR UPDATE`,
        [drawId]
      );

      if (drawRes.rows.length === 0) {
        throw new AppError('Draw not found.', 404);
      }

      const draw = drawRes.rows[0];

      if (draw.status !== 'SIMULATED') {
        if (draw.status === 'PUBLISHED') {
          throw new AppError('This draw has already been published.', 409);
        }
        throw new AppError(
          `Cannot publish a draw with status '${draw.status}'. Only SIMULATED draws can be published.`,
          422
        );
      }

      const winningNumbers = draw.winning_numbers;

      // 2. Fetch active subscribers and their scores for winner re-computation
      //    (Re-compute to ensure consistency — the simulation data is the authoritative source)
      const activeSubscribers = await this._getActiveSubscribers(client);
      const userIds = activeSubscribers.map((s) => s.user_id);
      const scoreMap = await this._fetchSubscriberScores(client, userIds);

      // 3. Re-run the matching engine with the stored winning numbers
      const winnerGroups = this._runMatchingEngine(activeSubscribers, scoreMap, winningNumbers);

      // 4. Compute prize-per-winner from the stored pool values
      const tierPools = {
        match5Cents: draw.pool_match_5_cents,
        match4Cents: draw.pool_match_4_cents,
        match3Cents: draw.pool_match_3_cents,
      };
      const { prizePerWinner } = this._calculateWinnerPrizes(winnerGroups, tierPools);

      // 5. Update draw status to PUBLISHED
      await client.query(
        `UPDATE monthly_draws
         SET status = 'PUBLISHED',
             published_at = NOW(),
             published_by = $1
         WHERE id = $2`,
        [adminUserId, drawId]
      );

      // 6. Insert official draw_winners records
      const allWinners = [
        ...winnerGroups.match5.map((w) => ({ ...w, prize: prizePerWinner.match5 })),
        ...winnerGroups.match4.map((w) => ({ ...w, prize: prizePerWinner.match4 })),
        ...winnerGroups.match3.map((w) => ({ ...w, prize: prizePerWinner.match3 })),
      ];

      for (const winner of allWinners) {
        await client.query(
          `INSERT INTO draw_winners (
             draw_id, user_id, tier, matched_count,
             user_matched_numbers, prize_amount_cents, status
           ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING_PROOF')
           ON CONFLICT (draw_id, user_id) DO NOTHING`,
          [
            drawId,
            winner.user_id,
            winner.tier,
            winner.matched_count,
            winner.matched_numbers,
            winner.prize,
          ]
        );
      }

      await client.query('COMMIT');

      // Return a summary of the published draw
      const publishedRes = await query(
        `SELECT id, draw_month, draw_type, status, winning_numbers,
                prize_pool_percentage, total_active_subscribers,
                gross_pool_cents,
                pool_match_5_cents, pool_match_4_cents, pool_match_3_cents,
                rollover_from_previous_cents, rollover_to_next_cents,
                simulated_at, published_at, created_by, published_by
         FROM monthly_draws WHERE id = $1`,
        [drawId]
      );

      const published = publishedRes.rows[0];

      return {
        draw_id: published.id,
        month: published.draw_month,
        type: published.draw_type,
        status: published.status,
        winning_numbers: published.winning_numbers,
        active_subscriber_count: published.total_active_subscribers,
        prize_pool_percentage: parseFloat(published.prize_pool_percentage),
        gross_pool_cents: published.gross_pool_cents,
        rollover_from_previous_cents: published.rollover_from_previous_cents,
        pool_match_5_cents: published.pool_match_5_cents,
        pool_match_4_cents: published.pool_match_4_cents,
        pool_match_3_cents: published.pool_match_3_cents,
        winner_counts: {
          match_5: winnerGroups.match5.length,
          match_4: winnerGroups.match4.length,
          match_3: winnerGroups.match3.length,
        },
        prize_per_winner_cents: {
          match_5: prizePerWinner.match5,
          match_4: prizePerWinner.match4,
          match_3: prizePerWinner.match3,
        },
        rollover_to_next_cents: published.rollover_to_next_cents,
        published_at: published.published_at,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Fetch an existing simulated draw state by ID
   */
  async getSimulationById(drawId) {
    const res = await query(`
      SELECT 
        id, draw_month, draw_type, status, winning_numbers,
        prize_pool_percentage, total_active_subscribers,
        gross_pool_cents, pool_match_5_cents, pool_match_4_cents,
        pool_match_3_cents, rollover_from_previous_cents,
        rollover_to_next_cents, simulated_at
      FROM monthly_draws
      WHERE id = $1 AND status = 'SIMULATED'
    `, [drawId]);
    
    if (res.rows.length === 0) {
      throw new AppError('Simulation not found or already published.', 404);
    }
    
    return res.rows[0];
  }

  /**
   * Get a user's draw participation history (published draws only).
   * Returns draws where the user appeared as a winner.
   *
   * @param {string} userId
   */
  async getUserDrawHistory(userId) {
    const res = await query(
      `SELECT
         md.id AS draw_id,
         md.draw_month,
         md.draw_type,
         md.winning_numbers,
         md.published_at,
         dw.tier,
         dw.matched_count,
         dw.user_matched_numbers,
         dw.prize_amount_cents,
         dw.status AS winner_status
       FROM draw_winners dw
       JOIN monthly_draws md ON md.id = dw.draw_id
       WHERE dw.user_id = $1
         AND md.status = 'PUBLISHED'
       ORDER BY md.draw_month DESC`,
      [userId]
    );

    return res.rows;
  }

  /**
   * Get the latest published draw for the public endpoint.
   * Returns no private user data.
   *
   * @returns {object|null}
   */
  async getLatestPublishedDraw() {
    const res = await query(
      `SELECT
         id, draw_month, draw_type, winning_numbers,
         total_active_subscribers,
         gross_pool_cents,
         pool_match_5_cents, pool_match_4_cents, pool_match_3_cents,
         rollover_from_previous_cents, rollover_to_next_cents,
         published_at
       FROM monthly_draws
       WHERE status = 'PUBLISHED'
       ORDER BY draw_month DESC
       LIMIT 1`
    );

    return res.rows.length > 0 ? res.rows[0] : null;
  }
}

module.exports = new DrawService();
