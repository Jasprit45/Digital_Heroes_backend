const app = require('./app');
const { pool } = require('./config/database');

const PORT = process.env.Frontend || 5000;

const server = app.listen(PORT, () => {
  console.log(`🌐 Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  console.log(`🔗 API Base URL: http://localhost:${PORT}${process.env.API_PREFIX || '/api/v1'}`);
});

// Unhandled Rejections and Exception Handling
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION 💥 Shutting down...', err);
  server.close(() => {
    pool.end();
    process.exit(1);
  });
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION 💥 Shutting down...', err);
  pool.end();
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('👋 SIGTERM RECEIVED. Shutting down gracefully...');
  server.close(() => {
    pool.end();
    console.log('💥 Process terminated!');
  });
});
