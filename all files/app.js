require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const logger = require('./utils/logger');
const tracing = require('./middleware/tracing');
const cookieParser = require('cookie-parser');
const requestLogger = require('./middleware/requestLogger');
const idempotency = require('./middleware/idempotency');

// Import rate limiters
// const {
//   globalLimiter,
//   authLimiter,
//   purchaseLimiter,
// } = require('./middleware/rateLimiter');
// Initialize app
const app = express();

// Middleware
app.use(
  cors({
    origin: true, // Reflects the request origin
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token'],
  })
);

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(tracing);
app.use(requestLogger);
app.use(idempotency);
app.use(cookieParser(process.env.COOKIE_SECRET));

// Database connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => logger.info('MongoDB connected successfully'))
  .catch((err) => {
    logger.error('MongoDB connection error:', err);
    process.exit(1);
  });

mongoose.connection.on('connected', () => {
  logger.info('Mongoose connected to DB');
});

mongoose.connection.on('error', (err) => {
  logger.error('Mongoose connection error:', err);
});

// Request logging
app.use((req, err, res, next) => {
  err.correlationId = req.correlationId;
  logger.info(`${req.method} ${req.originalUrl}`);
  next();
});

// Apply global limiter to all routes
// app.use(globalLimiter);

// // Apply stricter limiters to specific routes
// app.use('/api/auth/login', authLimiter);
// app.use('/api/auth/register', authLimiter);
// app.use('/api/tickets/purchase', purchaseLimiter);

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/events', require('./routes/eventRoutes'));
app.use('/api/tickets', require('./routes/ticketRoutes'));
app.use('/api/dashboard', require('./routes/dashboard')); // Add with other routes
app.use('/api/health', require('./routes/healthRoutes'));

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date(),
    dbState: mongoose.connection.readyState,
  });
});

// Error handling middleware (must be after all routes)
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

// Serve static assets in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('client/build'));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'client', 'build', 'index.html'));
  });
}

// Server
const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  logger.info(
    `Server running in ${
      process.env.NODE_ENV || 'development'
    } mode on port ${PORT}`
  );
});

// Handle unhandled rejections
process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED REJECTION! Shutting down...');
  logger.error(err.name, err.message);
  server.close(() => process.exit(1));
});

// Handle shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down server...');
  server.close(() => {
    mongoose.connection.close(false, () => {
      logger.info('MongoDB connection closed');
      process.exit(0);
    });
  });
});

module.exports = app;
