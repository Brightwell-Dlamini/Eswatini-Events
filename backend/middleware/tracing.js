const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

// Track active requests to prevent duplicates
const activeRequests = new Set();

module.exports = (req, res, next) => {
  const requestId = req.headers['x-request-id'] || uuidv4();

  // Skip if this request is already being tracked
  if (activeRequests.has(requestId)) return next();
  activeRequests.add(requestId);

  const start = Date.now();
  req.requestId = requestId;
  res.set('X-Request-ID', requestId);

  // Create ONE logger instance per request
  req.logger = logger.child({
    requestId,
    method: req.method,
    path: req.path,
  });

  // Log request start (ONLY ONCE)
  req.logger.info('Request started');

  const cleanup = () => {
    // Calculate duration and log completion
    const duration = Date.now() - start;
    req.logger.info('Request completed', {
      status: res.statusCode,
      duration: `${duration}ms`,
    });

    // Clean up
    activeRequests.delete(requestId);
    res.off('finish', cleanup);
    res.off('close', cleanup);
  };

  res.on('finish', cleanup);
  res.on('close', cleanup);

  next();
};
