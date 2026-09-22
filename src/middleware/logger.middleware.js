const morgan = require('morgan');

// Format HTTP requests for console output
const format = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';

const requestLogger = morgan(format);

module.exports = requestLogger;
