# Digital Heroes Platform — Business & Technical Assumptions

This document lists all explicit business and technical assumptions derived from the Digital Heroes 2026 PRD analysis and refined during architectural alignment.

---

## 1. User Roles & Security
- **Roles Model**: The system strictly supports two database roles: `USER` and `ADMIN`. Unauthenticated users are treated as public visitors at the HTTP request layer without requiring a database role.
- **Session & Refresh Token Revocation**: Token invalidation and session tracking are persisted in PostgreSQL (`refresh_tokens` table). Logouts immediately revoke the refresh token by setting `is_revoked = TRUE`.
- **Subscription Checks**: Access to protected gameplay features (score entry, draw participation, winnings access) requires a real-time database query against the `subscriptions` table (`status = 'ACTIVE'` and `current_period_end > NOW()`). Subscription state is never read from JWT token claims.

---

## 2. Score Management & Concurrency Constraints
- **Stableford Bounds**: Golf scores must be integers between 1 and 45 (inclusive).
- **Date Constraints**: Score dates (`played_on`) cannot be in the future (`played_on <= CURRENT_DATE`).
- **One Score Per Date**: A user may only have one score entry per calendar date. Duplicate submissions for an existing date are rejected with an error. Existing entries can only be edited or deleted.
- **Rolling 5 Retention & Concurrency Safety**: The system retains only the latest 5 scores per user (ordered by `played_on DESC`). Insertion and pruning are executed inside an ACID PostgreSQL transaction with explicit row-level locking (`SELECT ... FOR UPDATE` on user subscriptions/user record) to prevent race conditions during rapid concurrent score entries.

---

## 3. Subscriptions & Payment Synchronization
- **Stripe Authoritative Source**: Stripe webhooks (`checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.deleted`) serve as the authoritative trigger for updating user subscription statuses in the database.
- **Independent Charity Donations**: Non-subscribers and public visitors can make direct, standalone donations to any listed charity without requiring an account or active subscription.

---

## 4. Draw & Prize Calculation Mechanics
- **Configurable Prize Pool**: The percentage of subscription fees allocated to the prize pool is dynamic and configurable via the `system_configs` table (`prize_pool_percentage`), defaulting to 50.00%. It is never hardcoded in application logic.
- **Backend Draw Number Generation**: Winning draw numbers (5 unique integers between 1 and 45) are generated exclusively by the backend via secure random selection (Random mode) or score frequency weighted distribution (Algorithmic mode).
- **Separation of Simulation & Publishing**: Draw calculation happens in two distinct phases:
  1. `Simulate`: Calculates pool splits, generates numbers, runs matching logic, and creates a `SIMULATED` draft visible only to administrators.
  2. `Publish`: Admin reviews and publishes the draw, locking results, persisting official `draw_winners` records, and updating rollover totals.
- **Score Matching Logic**: Match tiers (5-match, 4-match, 3-match) are determined by calculating the **unordered set intersection** between a user's 5 active scores and the 5 winning draw numbers.
- **Rollover Rules**:
  - Unclaimed Tier 1 (5-number match jackpot) funds carry forward to the next month's Tier 1 pool.
  - Unclaimed Tier 2 (4-number match) or Tier 3 (3-number match) funds are transferred to the platform's monthly Charity Fund.

---

## 5. Storage & File Proofs
- **Winner Proof Uploads**: Score proof screenshots uploaded by winners are stored in cloud object storage (e.g. Supabase Storage / AWS S3), and HTTPS URLs are persisted in the `draw_winners.proof_image_url` table column for admin verification.

---

## 6. Draw Engine & Prize Pool (Phase 6)

### 6.1 Money Representation
- **Integer Cents**: All monetary values are stored and computed as integer cents (`INT`). Floating-point arithmetic is never used in any prize calculation path.
- **Gross Pool Calculation**: The gross prize pool is computed as `SUM(price_cents per active subscriber) × prize_pool_percentage / 100`, accumulated using integer arithmetic. This correctly handles subscribers on different plans (MONTHLY vs YEARLY) with different `price_cents` values.

### 6.2 Rounding & Remainder Strategy
- **Per-winner Prize**: `Math.floor(tierPoolCents / winnerCount)` is used for all tier splits.
- **Remainder Handling**:
  - `MATCH_5` remainder (i.e. `pool - winners × prizePerWinner`) is added to `rollover_to_next_cents` for the next month's MATCH_5 jackpot.
  - `MATCH_4` and `MATCH_3` remainders are directed to the Charity Contribution Fund (consistent with the documented Unclaimed Funds assumption in §4).
- This strategy is fully deterministic and avoids fractional cents.

### 6.3 Jackpot Rollover
- If `MATCH_5` has zero winners, the entire `pool_match_5_cents` rolls over to `rollover_to_next_cents`.
- The following month's `MATCH_5` pool is: `40% of current gross pool + rollover_from_previous_cents`.
- `MATCH_4` and `MATCH_3` do **not** roll over. Unclaimed amounts go to the Charity Fund.

### 6.4 Simulation vs Publishing
- **Simulate** (`SIMULATED` status): calculates all draw results and stores a draft visible only to admins. No official `draw_winners` records are created.
- **Publish** (`PUBLISHED` status): atomically transitions the draw, creates official `draw_winners` records, and makes the draw publicly visible. Publishing re-runs the matching engine against the stored winning numbers to ensure consistency.
- A `SIMULATED` draw can be **re-simulated** (replaced). A `PUBLISHED` draw **cannot** be re-simulated or re-published.

### 6.5 Algorithmic Draw Fallback
- If there are no active subscriber scores at simulation time (all histogram frequencies are zero), the algorithmic mode falls back to **uniform weights** — equivalent to `RANDOM` mode.
- This fallback is intentional, safe, and logged in this document. It does not cause a crash or error.

### 6.6 Score Scope for Algorithmic Draw
- The ALGORITHMIC mode histogram uses **all scores currently stored** for each eligible active subscriber (their latest 5 scores), not just scores played within the specific draw month.
- This is consistent with the documented assumption: "fetch their current latest 5 stored golf scores."

### 6.7 Active Subscriber Eligibility
- A subscriber is eligible if `status = 'ACTIVE'` AND `current_period_end > NOW()` at simulation time.
- The count and composition of active subscribers is a **simulation-time snapshot**.
- For the prize pool, each subscriber's stored `price_cents` is used to compute the gross pool (not a hardcoded price).

### 6.8 Number Generation Security
- `RANDOM` mode: uses Node.js `crypto.randomInt()` (cryptographically secure). `Math.random()` is never used.
- `ALGORITHMIC` mode: uses crypto-secure random selection over a cumulative-weight range.

### 6.9 Match Tier Rules (Explicit)
- `MATCH_5` (5 matched numbers) = jackpot tier with rollover
- `MATCH_4` (4 matched numbers) = second tier
- `MATCH_3` (3 matched numbers) = third tier
- Fewer than 3 matches = not a winner; user is not eligible for any prize
- Matching is determined by **unordered set intersection** (each number counted at most once)
