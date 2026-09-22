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

// Security Middlewares
app.use(helmet());
app.use(cors());

// Webhook Raw Body Parser (Must be registered before express.json)
const apiPrefix = process.env.API_PREFIX || '/api/v1';
const webhookController = require('./modules/subscriptions/webhook.controller');
app.post(
  `${apiPrefix}/webhooks/stripe`,
  express.raw({ type: 'application/json' }),
  (req, res, next) => webhookController.handleStripeWebhook(req, res, next)
);

// Request Body & Cookie Parsing Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// HTTP Request Logger Middleware
app.use(requestLogger);

// API Routes mounting under /api/v1
app.use(apiPrefix, apiRoutes);

// Handle 404 Undefined Routes
app.all('*', (req, res, next) => {
  next(new AppError(`Cannot find endpoint ${req.originalUrl} on this server.`, 404));
});

// Global Centralized Error Handling Middleware
app.use(globalErrorHandler);

module.exports = app;
