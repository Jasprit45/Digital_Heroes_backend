const AppError = require('../utils/appError');

/**
 * Centralized error handler middleware
 */
const globalErrorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    return res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      stack: err.stack,
    });
  }

  // Production error payload (hide internal details for non-operational errors)
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  }

  // Programming or unknown errors: don't leak details to client
  console.error('ERROR 💥:', err);
  return res.status(500).json({
    status: 'error',
    message: 'Something went wrong on the server.',
  });
};

module.exports = globalErrorHandler;
