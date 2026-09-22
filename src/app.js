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
import cors from "cors";

const allowedOrigins = [
  "http://localhost:5173",
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without an Origin header
      // such as Postman/server-to-server requests.
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(helmet());
app.use(cors(corsOptions));

app.use(express.json());

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
