const { AppError } = require('../middleware/errorHandler');
const Ticket = require('../models/Ticket');
const logger = require('../utils/logger');

exports.handlePaymentWebhook = async (req, res, next) => {
  if (!req.headers['idempotency-key']) {
    throw new AppError('Idempotency key required', 400);
  }
  try {
    // 1. Verify webhook signature FIRST
    const signature = req.headers['x-payment-signature'];
    if (!signature || signature !== process.env.PAYMENT_WEBHOOK_SECRET) {
      throw new AppError('Invalid webhook signature', 401);
    }

    // 2. Log raw payload
    logger.info(
      `Webhook received: ${JSON.stringify(
        {
          headers: req.headers,
          body: req.body,
        },
        null,
        2
      )}`
    );

    // 3. Validate payload structure
    const { transactionId, status, ticketIds } = req.body;
    if (!transactionId || !status || !ticketIds?.length) {
      throw new AppError(
        'Missing required fields: transactionId, status, or ticketIds',
        400
      );
    }

    // 4. Process payment status
    if (status === 'success') {
      const updateResult = await Ticket.updateMany(
        { _id: { $in: ticketIds } },
        {
          $set: {
            paymentStatus: 'confirmed',
            transactionId,
            updatedAt: new Date(),
          },
        }
      );

      if (updateResult.modifiedCount === 0) {
        logger.warn(`No tickets updated for transaction ${transactionId}`);
      }
    }

    // 5. Always acknowledge receipt
    res.status(200).json({
      acknowledged: true,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`Webhook processing failed: ${err.message}`);
    next(err);
  }
};
