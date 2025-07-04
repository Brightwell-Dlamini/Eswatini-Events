const { AppError } = require('./errorHandler');

module.exports = (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'];

  if (!idempotencyKey) {
    throw new AppError('Idempotency-Key header required', 400, {
      solution: 'Retry with a unique key in headers',
    });
  }

  // Attach to request for later use
  req.idempotencyKey = idempotencyKey;
  next();
};
