const Stripe = require('stripe');
const dotenv = require('dotenv');

dotenv.config();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder_key_for_development';

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2023-10-16', // Standard API version for stability
});

module.exports = stripe;
