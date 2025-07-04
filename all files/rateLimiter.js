const rateLimit = require('express-rate-limit');
const { AppError } = require('./errorHandler');

// Global rate limiter (applies to all routes)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable deprecated headers
  handler: (req, res, next) => {
    next(new AppError('Too many requests, please try again later', 429));
  },
});

// Strict limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // Changed from 20 to match test expectations
  handler: (req, res, next) => {
    next(
      new AppError(
        'Too many login attempts, please try again in 15 minutes',
        429
      )
    );
  },
});

// Purchase endpoint protection
const purchaseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  handler: (req, res, next) => {
    next(
      new AppError(
        'Too many ticket purchases from this IP, try again in 1 hour',
        429
      )
    );
  },
});

module.exports = { globalLimiter, authLimiter, purchaseLimiter };
