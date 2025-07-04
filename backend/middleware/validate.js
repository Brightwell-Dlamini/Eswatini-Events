const { AppError } = require('./errorHandler');
const Joi = require('joi');

module.exports = (schema, options = {}) => {
  return (req, res, next) => {
    const { error } = schema.validate(options.query ? req.query : req.body, {
      abortEarly: false,
    });

    if (error) {
      const errorDetails = error.details.map((detail) => ({
        message: detail.message,
        path: detail.path,
      }));

      throw new AppError('Validation failed', 400, {
        details: errorDetails,
        solution: 'Please check your input and try again',
      });
    }
    next();
  };
};
