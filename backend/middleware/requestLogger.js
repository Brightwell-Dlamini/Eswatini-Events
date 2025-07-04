const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

module.exports = (req, res, next) => {
  // Skip logging for health checks (optional)
  if (req.path === '/api/health/live') return next();

  const requestId = req.headers['x-request-id'] || uuidv4();
  const start = Date.now();

  // Store directly on the request object
  req._requestStartTime = start;
  req._requestId = requestId;
  res.set('X-Request-ID', requestId);

  // Single log at start
  logger.info('Request started', {
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
  });

  // Only log completion when response finishes
  res.once('finish', () => {
    const duration = Date.now() - start;
    logger.info('Request completed', {
      requestId,
      status: res.statusCode,
      duration: `${duration}ms`,
      method: req.method,
      path: req.path,
    });
  });

  next();
};
