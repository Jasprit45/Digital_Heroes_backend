const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const requestLogger = require('./middleware/logger.middleware');
const globalErrorHandler = require('./middleware/error.middleware');
const apiRoutes = require('./routes');
const AppError = require('./utils/appError');

dotenv.config();

const app = express();

// 1. Centralized CORS Policy (MUST be registered first before any auth/router middleware)
const allowedOrigins = new Set([
  'http://localhost:5173',
  'https://digital-heroes-client.vercel.app',
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL.replace(/\/$/, '')] : [])
]);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. curl, server-to-server, Postman) without an Origin header
    if (!origin) {
      return callback(null, true);
    }
    const cleanOrigin = origin.replace(/\/$/, '');
    if (allowedOrigins.has(cleanOrigin)) {
      return callback(null, true);
    }
    // Block origin gracefully without throwing Express error
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
};

// Mount CORS middleware globally
app.use(cors(corsOptions));

// Explicit preflight handler for all routes
app.options('*', cors(corsOptions));

// 2. Security Headers (Helmet)
app.use(helmet());

// Webhook Raw Body Parser (Must be registered before standard json parser for Stripe signatures)
const apiPrefix = process.env.API_PREFIX || '/api/v1';
const webhookController = require('./modules/subscriptions/webhook.controller');
const stripeWebhookMiddleware = [
  express.raw({ type: 'application/json' }),
  (req, res, next) => webhookController.handleStripeWebhook(req, res, next)
];
app.post(`${apiPrefix}/webhooks/stripe`, stripeWebhookMiddleware);
if (apiPrefix !== '/v1') {
  app.post('/v1/webhooks/stripe', stripeWebhookMiddleware);
}
app.post('/webhooks/stripe', stripeWebhookMiddleware);

// 3. Request Body & Cookie Parsing Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// 4. HTTP Request Logger Middleware
app.use(requestLogger);

// 5. API Routes mounting under /api/v1 (plus /v1 and root / for Vercel serverless rewrites)
app.use(apiPrefix, apiRoutes);
if (apiPrefix !== '/v1') {
  app.use('/v1', apiRoutes);
}
app.use('/', apiRoutes);

// 6. Handle 404 Undefined Routes
app.all('*', (req, res, next) => {
  next(new AppError(`Cannot find endpoint ${req.originalUrl} on this server.`, 404));
});

// 7. Global Centralized Error Handling Middleware
app.use(globalErrorHandler);

module.exports = app;
