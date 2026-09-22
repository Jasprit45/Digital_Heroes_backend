/**
 * draw.engine.js
 *
 * Pure, stateless draw engine functions.
 * All functions are deterministic (where applicable) and independently testable.
 * No Express, no database, no side effects.
 *
 * Assumption: Score matching uses unordered set intersection.
 * Assumption: Remainder from prize splits is NOT distributed to winners;
 *             MATCH_5 remainder rolls over; MATCH_4/MATCH_3 remainder → Charity Fund.
 * Assumption: If algorithmic histogram has all-zero frequencies, uniform weights are used
 *             (equivalent to RANDOM mode). This is documented as a fallback.
 */

'use strict';

const { randomInt } = require('crypto');

// ---------------------------------------------------------------------------
// Number Generation
// ---------------------------------------------------------------------------

/**
 * Generate 5 unique winning numbers in the range [1, 45] using a
 * cryptographically secure random generator.
 *
 * Implements Fisher-Yates partial shuffle over a 1..45 range array.
 * Does NOT use Math.random().
 *
 * @returns {number[]} Sorted array of 5 unique integers between 1 and 45.
 */
function generateRandomWinningNumbers() {
  const POOL_SIZE = 45;
  const PICK_COUNT = 5;

  // Build a 1..45 pool
  const pool = Array.from({ length: POOL_SIZE }, (_, i) => i + 1);

  // Partial Fisher-Yates shuffle: pick PICK_COUNT elements
  for (let i = 0; i < PICK_COUNT; i++) {
    // randomInt(min, max) returns integer in [min, max)
    const j = i + randomInt(0, POOL_SIZE - i);
    // Swap pool[i] and pool[j]
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, PICK_COUNT).sort((a, b) => a - b);
}

/**
 * Build a frequency histogram for score values 1..45.
 *
 * @param {Array<{score: number}>} scores - Array of score objects with a `score` property.
 * @returns {Map<number, number>} Map from score value (1-45) to frequency count.
 */
function buildScoreFrequencyHistogram(scores) {
  const histogram = new Map();

  // Initialise every bucket from 1 to 45 with frequency 0
  for (let i = 1; i <= 45; i++) {
    histogram.set(i, 0);
  }

  for (const entry of scores) {
    const val = entry.score;
    if (Number.isInteger(val) && val >= 1 && val <= 45) {
      histogram.set(val, histogram.get(val) + 1);
    }
  }

  return histogram;
}

/**
 * Generate 5 unique winning numbers using weighted sampling without replacement.
 *
 * Higher-frequency score values have proportionally higher probability.
 * If all weights are zero (no scores), falls back to uniform distribution (equal weight = 1 per slot).
 *
 * Uses crypto-secure random selection through a cumulative-weight approach.
 *
 * @param {Map<number, number>} histogram - Score frequency histogram from buildScoreFrequencyHistogram().
 * @returns {number[]} Sorted array of 5 unique integers between 1 and 45.
 */
function generateWeightedWinningNumbers(histogram) {
  const PICK_COUNT = 5;

  // Build working arrays from the histogram
  let values = [];
  let weights = [];

  histogram.forEach((freq, val) => {
    values.push(val);
    weights.push(freq);
  });

  // Fallback: if total weight is 0, use uniform weights
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight === 0) {
    weights = weights.map(() => 1);
  }

  const picked = [];

  for (let i = 0; i < PICK_COUNT; i++) {
    // Recompute cumulative weights for remaining values
    const remaining = values
      .map((v, idx) => ({ value: v, weight: weights[idx] }))
      .filter((item) => !picked.includes(item.value));

    let cumWeightTotal = remaining.reduce((sum, item) => sum + item.weight, 0);

    // If all remaining weights are 0 (e.g. after picking the only heavy item),
    // fall back to uniform weights for this pick.
    const workingRemaining =
      cumWeightTotal === 0
        ? remaining.map((item) => ({ ...item, weight: 1 }))
        : remaining;

    cumWeightTotal = workingRemaining.reduce((sum, item) => sum + item.weight, 0);

    // Pick a cryptographically secure random integer in [0, cumWeightTotal)
    const rand = randomInt(0, cumWeightTotal);

    let cumulative = 0;
    let chosen = workingRemaining[workingRemaining.length - 1].value; // default to last

    for (const item of workingRemaining) {
      cumulative += item.weight;
      if (rand < cumulative) {
        chosen = item.value;
        break;
      }
    }

    picked.push(chosen);
  }

  return picked.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Matching Engine
// ---------------------------------------------------------------------------

/**
 * Calculate how many of a user's scores match the winning numbers.
 * Uses unordered set intersection — each number counted at most once.
 *
 * @param {number[]} userScores - Array of user score integers (up to 5 values).
 * @param {number[]} winningNumbers - Array of 5 unique winning integers.
 * @returns {{ matchedCount: number, matchedNumbers: number[] }}
 */
function calculateMatchCount(userScores, winningNumbers) {
  const winSet = new Set(winningNumbers);
  const userSet = new Set(userScores); // removes any duplicate user scores

  const matchedNumbers = [];
  for (const val of userSet) {
    if (winSet.has(val)) {
      matchedNumbers.push(val);
    }
  }

  return {
    matchedCount: matchedNumbers.length,
    matchedNumbers: matchedNumbers.sort((a, b) => a - b),
  };
}

/**
 * Determine the match tier from a match count.
 *
 * @param {number} matchedCount
 * @returns {'MATCH_5' | 'MATCH_4' | 'MATCH_3' | null}
 */
function getMatchTier(matchedCount) {
  if (matchedCount === 5) return 'MATCH_5';
  if (matchedCount === 4) return 'MATCH_4';
  if (matchedCount === 3) return 'MATCH_3';
  return null;
}

// ---------------------------------------------------------------------------
// Prize Pool Calculations (Integer Cents Only)
// ---------------------------------------------------------------------------

/**
 * Calculate the gross prize pool in integer cents.
 *
 * Uses the sum of each active subscriber's individual price_cents
 * to handle mixed plan pricing correctly.
 *
 * @param {Array<{price_cents: number}>} activeSubscribers - Array of subscriber objects with price_cents.
 * @param {number} poolPercentage - Prize pool percentage (e.g. 50.00 for 50%).
 * @returns {number} Gross pool in integer cents (always >= 0).
 */
function calculatePrizePool(activeSubscribers, poolPercentage) {
  const totalRevenueCents = activeSubscribers.reduce(
    (sum, sub) => sum + Math.trunc(sub.price_cents || 0),
    0
  );

  // Multiply by percentage using integer arithmetic
  // poolPercentage is stored as a numeric like 50.00
  // Multiply by 10000 to avoid float, then divide. Keep as integer.
  const grossPoolCents = Math.floor((totalRevenueCents * poolPercentage) / 100);
  return Math.max(0, grossPoolCents);
}

/**
 * Calculate tier pool allocations in integer cents.
 *
 * MATCH_5 pool = (40% of grossPoolCents) + rolloverFromPreviousCents
 * MATCH_4 pool = 35% of grossPoolCents
 * MATCH_3 pool = 25% of grossPoolCents
 *
 * Tier percentages are passed in from system_configs (not hardcoded here).
 *
 * @param {number} grossPoolCents - Total prize pool in cents.
 * @param {number} rolloverFromPreviousCents - Previous month's MATCH_5 rollover (cents).
 * @param {{ match_5: number, match_4: number, match_3: number }} tierSplits - Percentages from config.
 * @returns {{ match5Cents: number, match4Cents: number, match3Cents: number }}
 */
function calculateTierPools(grossPoolCents, rolloverFromPreviousCents, tierSplits) {
  const match5Base = Math.floor((grossPoolCents * tierSplits.match_5) / 100);
  const match4Cents = Math.floor((grossPoolCents * tierSplits.match_4) / 100);
  const match3Cents = Math.floor((grossPoolCents * tierSplits.match_3) / 100);

  // MATCH_5 includes previous month's rollover
  const match5Cents = match5Base + Math.max(0, rolloverFromPreviousCents || 0);

  return {
    match5Cents,
    match4Cents,
    match3Cents,
  };
}

/**
 * Split a tier pool equally among winners using integer-cent arithmetic.
 *
 * Uses Math.floor for per-winner amount.
 * Remainder (pool - winnerCount × prizePerWinner) is NOT given to winners.
 * The caller handles the remainder per documented assumption:
 *   - MATCH_5 remainder: added to rollover_to_next_cents
 *   - MATCH_4 / MATCH_3 remainder: directed to Charity Contribution Fund
 *
 * @param {number} tierPoolCents - Total pool for this tier in cents.
 * @param {number} winnerCount - Number of winners in this tier.
 * @returns {{ prizePerWinnerCents: number, remainderCents: number }}
 */
function splitPrizeAmongWinners(tierPoolCents, winnerCount) {
  if (winnerCount <= 0) {
    return { prizePerWinnerCents: 0, remainderCents: tierPoolCents };
  }

  const prizePerWinnerCents = Math.floor(tierPoolCents / winnerCount);
  const remainderCents = tierPoolCents - prizePerWinnerCents * winnerCount;

  return { prizePerWinnerCents, remainderCents };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  generateRandomWinningNumbers,
  buildScoreFrequencyHistogram,
  generateWeightedWinningNumbers,
  calculateMatchCount,
  getMatchTier,
  calculatePrizePool,
  calculateTierPools,
  splitPrizeAmongWinners,
};
