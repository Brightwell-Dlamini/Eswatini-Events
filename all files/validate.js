const AppError = require('./errorHandler');
const { purchaseTicket, transferTicket } = require('../schemas/ticketSchemas');

const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body);
  if (error) {
    throw new AppError(`Validation error: ${error.details[0].message}`, 400);
  }
  next();
};

module.exports = {
  validatePurchase: validate(purchaseTicket),
  validateTransfer: validate(transferTicket),
};
