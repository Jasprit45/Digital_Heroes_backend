const stripe = require('../../config/stripe');
const { query } = require('../../config/database');
const AppError = require('../../utils/appError');

class SubscriptionService {
  /**
   * Create Stripe Checkout Session for subscription
   */
  async createCheckoutSession(userId, { plan, selected_charity_id, charity_percentage }) {
    // 1. Validate plan type
    if (plan !== 'MONTHLY' && plan !== 'YEARLY') {
      throw new AppError('Invalid plan. Must be MONTHLY or YEARLY.', 400);
    }

    // 2. Determine Price ID from backend environment configuration
    const priceId =
      plan === 'MONTHLY'
        ? process.env.STRIPE_MONTHLY_PRICE_ID
        : process.env.STRIPE_YEARLY_PRICE_ID;

    if (!priceId) {
      throw new AppError(`Stripe price configuration missing for plan: ${plan}`, 500);
    }

    // 2. Validate Charity existence if provided
    if (selected_charity_id) {
      const charityRes = await query('SELECT id FROM charities WHERE id = $1 AND is_active = true', [selected_charity_id]);
      if (charityRes.rows.length === 0) {
        throw new AppError('Selected charity does not exist.', 400);
      }
    }

    // 3. Find or Create Stripe Customer for User
    let stripeCustomerId = null;
    const existingSubRes = await query('SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1', [userId]);
    
    if (existingSubRes.rows.length > 0 && existingSubRes.rows[0].stripe_customer_id) {
      stripeCustomerId = existingSubRes.rows[0].stripe_customer_id;
    } else {
      const userRes = await query('SELECT email, full_name FROM users WHERE id = $1', [userId]);
      if (userRes.rows.length === 0) {
        throw new AppError('User not found.', 404);
      }
      const user = userRes.rows[0];

      const customer = await stripe.customers.create({
        email: user.email,
        name: user.full_name,
        metadata: { user_id: userId },
      });
      stripeCustomerId = customer.id;
    }

    // 4. Create Stripe Checkout Session
    const successUrl = process.env.CLIENT_SUCCESS_URL || 'http://localhost:3000/subscription/success?session_id={CHECKOUT_SESSION_ID}';
    const cancelUrl = process.env.CLIENT_CANCEL_URL || 'http://localhost:3000/subscription/cancel';

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        user_id: userId,
        plan,
        selected_charity_id: selected_charity_id || '',
        charity_percentage: charity_percentage.toString(),
      },
    });

    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  /**
   * Get subscription status from PostgreSQL (Authoritative source)
   */
  async getSubscriptionStatus(userId) {
    const subRes = await query(
      `SELECT plan, status, price_cents, charity_percentage, selected_charity_id,
              current_period_start, current_period_end, cancel_at_period_end
       FROM subscriptions
       WHERE user_id = $1`,
      [userId]
    );

    if (subRes.rows.length === 0) {
      return {
        status: 'INACTIVE',
        plan: null,
        price_cents: 0,
        charity_percentage: 10.0,
        selected_charity_id: null,
        current_period_start: null,
        current_period_end: null,
        cancel_at_period_end: false,
      };
    }

    return subRes.rows[0];
  }

  /**
   * Handle verified Stripe webhook events with idempotency check
   */
  async handleWebhookEvent(event) {
    const eventId = event.id;
    const eventType = event.type;

    // Idempotency Check: Insert into stripe_webhook_events
    const insertEventRes = await query(
      `INSERT INTO stripe_webhook_events (id, event_type)
       VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [eventId, eventType]
    );

    // If no row was inserted, event has already been processed
    if (insertEventRes.rows.length === 0) {
      return { duplicate: true, message: 'Event already processed.' };
    }

    switch (eventType) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata ? session.metadata.user_id : null;
        const plan = session.metadata ? session.metadata.plan : 'MONTHLY';
        const charityId = session.metadata && session.metadata.selected_charity_id ? session.metadata.selected_charity_id : null;
        const charityPct = session.metadata && session.metadata.charity_percentage ? parseFloat(session.metadata.charity_percentage) : 10.0;

        if (userId && session.subscription) {
          const stripeSub = await stripe.subscriptions.retrieve(session.subscription);
          const priceCents = (stripeSub.items && stripeSub.items.data[0] && stripeSub.items.data[0].price) ? stripeSub.items.data[0].price.unit_amount : 0;
          const periodStart = stripeSub.current_period_start;
          const periodEnd = stripeSub.current_period_end;
          const cancelAtPeriodEnd = stripeSub.cancel_at_period_end || false;

          await query(
            `INSERT INTO subscriptions (
               user_id, stripe_customer_id, stripe_subscription_id, plan, status, price_cents,
               charity_percentage, selected_charity_id, current_period_start, current_period_end, cancel_at_period_end
             ) VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7, to_timestamp($8), to_timestamp($9), $10)
             ON CONFLICT (user_id) DO UPDATE SET
               stripe_customer_id = EXCLUDED.stripe_customer_id,
               stripe_subscription_id = EXCLUDED.stripe_subscription_id,
               plan = EXCLUDED.plan,
               status = 'ACTIVE',
               price_cents = EXCLUDED.price_cents,
               charity_percentage = EXCLUDED.charity_percentage,
               selected_charity_id = EXCLUDED.selected_charity_id,
               current_period_start = EXCLUDED.current_period_start,
               current_period_end = EXCLUDED.current_period_end,
               cancel_at_period_end = EXCLUDED.cancel_at_period_end,
               updated_at = CURRENT_TIMESTAMP`,
            [
              userId,
              session.customer,
              session.subscription,
              plan,
              priceCents,
              charityPct,
              charityId,
              periodStart,
              periodEnd,
              cancelAtPeriodEnd,
            ]
          );
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const stripeSub = await stripe.subscriptions.retrieve(invoice.subscription);
          await query(
            `UPDATE subscriptions SET
               status = 'ACTIVE',
               current_period_start = to_timestamp($1),
               current_period_end = to_timestamp($2),
               cancel_at_period_end = $3,
               updated_at = CURRENT_TIMESTAMP
             WHERE stripe_subscription_id = $4`,
            [
              stripeSub.current_period_start,
              stripeSub.current_period_end,
              stripeSub.cancel_at_period_end || false,
              invoice.subscription,
            ]
          );
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await query(
            `UPDATE subscriptions SET
               status = 'PAST_DUE',
               updated_at = CURRENT_TIMESTAMP
             WHERE stripe_subscription_id = $1`,
            [invoice.subscription]
          );
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object;
        await query(
          `UPDATE subscriptions SET
             status = 'CANCELLED',
             updated_at = CURRENT_TIMESTAMP
           WHERE stripe_subscription_id = $1`,
          [stripeSub.id]
        );
        break;
      }

      default:
        // Ignore unhandled event types cleanly
        break;
    }

    return { success: true };
  }
}

module.exports = new SubscriptionService();
