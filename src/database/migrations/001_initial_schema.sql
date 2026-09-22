-- Digital Heroes Initial Database Migration Schema
-- Version: 001
-- Description: Core tables, enums, indexes, and constraints for Digital Heroes platform

BEGIN;

-- Custom Enums (Strictly USER and ADMIN roles)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('USER', 'ADMIN');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_plan') THEN
        CREATE TYPE subscription_plan AS ENUM ('MONTHLY', 'YEARLY');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
        CREATE TYPE subscription_status AS ENUM ('INACTIVE', 'ACTIVE', 'CANCELLED', 'PAST_DUE');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'draw_type') THEN
        CREATE TYPE draw_type AS ENUM ('RANDOM', 'ALGORITHMIC');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'draw_status') THEN
        CREATE TYPE draw_status AS ENUM ('DRAFT', 'SIMULATED', 'PUBLISHED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'winner_status') THEN
        CREATE TYPE winner_status AS ENUM ('PENDING_PROOF', 'PROOF_SUBMITTED', 'VERIFIED', 'REJECTED', 'PAID');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'match_tier') THEN
        CREATE TYPE match_tier AS ENUM ('MATCH_5', 'MATCH_4', 'MATCH_3');
    END IF;
END $$;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role user_role NOT NULL DEFAULT 'USER',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Refresh Tokens / Sessions Table (For auth revocation & explicit logout)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. System Configurations Table (Configurable Prize Pool %, etc.)
CREATE TABLE IF NOT EXISTS system_configs (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed default system config for prize pool allocation
INSERT INTO system_configs (key, value, description)
VALUES 
    ('prize_pool_percentage', '50.00'::jsonb, 'Percentage of subscription fee allocated to the monthly prize pool'),
    ('match_tier_splits', '{"match_5": 40.0, "match_4": 35.0, "match_3": 25.0}'::jsonb, 'Percentage distribution per draw match tier')
ON CONFLICT (key) DO NOTHING;

-- 4. Charities Table
CREATE TABLE IF NOT EXISTS charities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT NOT NULL,
    logo_url TEXT,
    banner_url TEXT,
    is_featured BOOLEAN DEFAULT FALSE,
    events JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Subscriptions Table
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id VARCHAR(255) UNIQUE NOT NULL,
    stripe_subscription_id VARCHAR(255) UNIQUE,
    plan subscription_plan NOT NULL,
    status subscription_status NOT NULL DEFAULT 'INACTIVE',
    price_cents INT NOT NULL,
    charity_percentage NUMERIC(5,2) NOT NULL DEFAULT 10.00 CHECK (charity_percentage >= 10.00 AND charity_percentage <= 100.00),
    selected_charity_id UUID REFERENCES charities(id) ON DELETE SET NULL,
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Independent Charity Donations Table (No subscription required)
CREATE TABLE IF NOT EXISTS charity_donations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Optional (can be guest)
    charity_id UUID NOT NULL REFERENCES charities(id) ON DELETE CASCADE,
    donor_email VARCHAR(255),
    amount_cents INT NOT NULL CHECK (amount_cents > 0),
    stripe_payment_intent_id VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Golf Scores Table (Rolling 5 limit per user + 1 score per date constraint)
CREATE TABLE IF NOT EXISTS golf_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INT NOT NULL CHECK (score >= 1 AND score <= 45),
    played_on DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_score_per_date UNIQUE(user_id, played_on)
);

-- 8. Monthly Draws Table
CREATE TABLE IF NOT EXISTS monthly_draws (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    draw_month VARCHAR(7) NOT NULL UNIQUE, -- Format: 'YYYY-MM'
    draw_type draw_type NOT NULL DEFAULT 'RANDOM',
    status draw_status NOT NULL DEFAULT 'DRAFT',
    winning_numbers INT[] DEFAULT '{}', -- 5 numbers generated by backend
    prize_pool_percentage NUMERIC(5,2) NOT NULL,
    total_active_subscribers INT DEFAULT 0,
    gross_pool_cents INT DEFAULT 0,
    pool_match_5_cents INT DEFAULT 0,
    pool_match_4_cents INT DEFAULT 0,
    pool_match_3_cents INT DEFAULT 0,
    rollover_from_previous_cents INT DEFAULT 0,
    rollover_to_next_cents INT DEFAULT 0,
    simulated_at TIMESTAMP WITH TIME ZONE,
    published_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id),
    published_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. Draw Winners Table
CREATE TABLE IF NOT EXISTS draw_winners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    draw_id UUID NOT NULL REFERENCES monthly_draws(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier match_tier NOT NULL,
    matched_count INT NOT NULL CHECK (matched_count IN (3, 4, 5)),
    user_matched_numbers INT[] NOT NULL,
    prize_amount_cents INT NOT NULL,
    status winner_status NOT NULL DEFAULT 'PENDING_PROOF',
    proof_image_url TEXT,
    rejection_reason TEXT,
    verified_at TIMESTAMP WITH TIME ZONE,
    verified_by UUID REFERENCES users(id),
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_draw_win UNIQUE(draw_id, user_id)
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash) WHERE is_revoked = FALSE;
CREATE INDEX IF NOT EXISTS idx_scores_user_date ON golf_scores(user_id, played_on DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_draw_winners_draw_tier ON draw_winners(draw_id, tier);
CREATE INDEX IF NOT EXISTS idx_draw_winners_user ON draw_winners(user_id);

COMMIT;
