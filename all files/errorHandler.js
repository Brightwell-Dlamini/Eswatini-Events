const logger = require('../utils/logger');
const { inspect } = require('util');

class AppError extends Error {
  constructor(message, statusCode, details = null, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

const handleJWTError = () =>
  new AppError('Invalid authentication token', 401, {
    solution: 'Please log in again',
  });

const handleJWTExpiredError = () =>
  new AppError('Your session has expired', 401, {
    solution: 'Please log in again',
  });

const handleValidationErrorDB = (err) =>
  new AppError('Invalid input data', 400, {
    fields: Object.keys(err.errors).map((key) => ({
      field: key,
      message: err.errors[key].message,
    })),
  });

const sendErrorDev = (err, res) => {
  logger.error(`💥 Development Error: ${err.stack}`);
  res.status(err.statusCode).json({
    status: err.status,
    message: err.message,
    details: err.details,
    stack: err.stack,
    error: inspect(err, { depth: null }),
  });
};

const sendErrorProd = (err, res) => {
  // Operational, trusted errors
  if (err.isOperational) {
    logger.warn(`⚠️ Operational Error: ${err.message}`, err.details);
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      requestId: res.locals.requestId,
      ...(err.details && { details: err.details }),
    });
  }
  // Unknown/untrusted errors
  else {
    logger.error(`💥 Critical Error: ${err.message}`, err);
    res.status(500).json({
      status: 'error',
      message: 'An unexpected error occurred. Our team has been notified.',
      referenceId: res.sentry, // Optional: Link to error tracking
    });
  }
};

module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, res);
  } else {
    let error = { ...err, message: err.message };

    if (error.name === 'JsonWebTokenError') error = handleJWTError();
    if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();
    if (error.name === 'ValidationError')
      error = handleValidationErrorDB(error);

    sendErrorProd(error, res);
  }
};

module.exports.AppError = AppError;
