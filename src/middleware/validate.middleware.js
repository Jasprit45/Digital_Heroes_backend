const AppError = require('../utils/appError');

/**
 * Middleware factory to validate request body/params/query using a Zod schema
 */
const validate = (schema) => (req, res, next) => {
  try {
    const result = schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    
    // Replace body with parsed & sanitized data
    if (result.body) {
      req.body = result.body;
    }
    
    next();
  } catch (error) {
    const issues = error.issues || error.errors;
    if (issues && Array.isArray(issues)) {
      const issueMessages = issues
        .map((err) => `${err.path ? err.path.join('.') : ''}: ${err.message}`)
        .join(', ');
      return next(new AppError(`Validation error: ${issueMessages}`, 400));
    }
    next(error);
  }
};

module.exports = validate;
