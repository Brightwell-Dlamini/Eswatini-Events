const Joi = require('joi');

module.exports = {
  // Ticket purchase validation
  purchaseTicket: Joi.object({
    eventId: Joi.string().hex().length(24).required(),
    tier: Joi.string().valid('VIP', 'Early Bird', 'General').default('General'),
    quantity: Joi.number().integer().min(1).max(10).default(1),
  }),

  // Ticket transfer validation
  transferTicket: Joi.object({
    email: Joi.string().email().required(),
  }),
};
