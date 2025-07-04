const { v4: uuidv4 } = require('uuid');

module.exports = (req, res, next) => {
  // Get idempotency key from header or generate new one
  const idempotencyKey = req.headers['idempotency-key'] || uuidv4();
  req.idempotencyKey = idempotencyKey;

  // Set response header
  res.set('Idempotency-Key', idempotencyKey);
  next();
};
