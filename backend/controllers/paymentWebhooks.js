const { AppError } = require('../middleware/errorHandler');
const crypto = require('crypto');
const Ticket = require('../models/Ticket');
const Event = require('../models/Event');
const User = require('../models/User');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

exports.handlePaymentWebhook = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Verify required headers
    if (!req.headers['idempotency-key']) {
      throw new AppError('Idempotency key required', 400, {
        code: 'MISSING_IDEMPOTENCY_KEY',
      });
    }

    // 2. Verify webhook signature
    const signature = req.headers['x-payment-signature'];
    const expectedSignature = crypto
      .createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (!signature || signature !== expectedSignature) {
      throw new AppError('Invalid webhook signature', 401, {
        code: 'INVALID_SIGNATURE',
      });
    }

    // 3. Log raw payload (sanitized)
    logger.info('Payment webhook received', {
      event: 'payment_webhook',
      transactionId: req.body?.transactionId,
      status: req.body?.status,
      ticketCount: req.body?.ticketIds?.length || 0,
      paymentMethod: req.body?.paymentMethod,
    });

    // 4. Validate payload structure
    const {
      transactionId,
      status,
      ticketIds,
      amount,
      currency,
      paymentMethod,
      customer,
    } = req.body;

    if (
      !transactionId ||
      !status ||
      !ticketIds?.length ||
      !amount ||
      !currency ||
      !paymentMethod
    ) {
      throw new AppError('Missing required fields in webhook payload', 400, {
        requiredFields: [
          'transactionId',
          'status',
          'ticketIds',
          'amount',
          'currency',
          'paymentMethod',
        ],
        code: 'MISSING_REQUIRED_FIELDS',
      });
    }

    // 5. Process based on payment status
    if (status === 'success') {
      // Get all tickets in single query
      const tickets = await Ticket.find({ _id: { $in: ticketIds } }).session(
        session
      );

      // Verify all tickets exist
      if (tickets.length !== ticketIds.length) {
        throw new AppError('Some tickets not found', 404, {
          found: tickets.length,
          requested: ticketIds.length,
          code: 'TICKETS_NOT_FOUND',
        });
      }

      // Check if tickets already have transaction IDs
      const alreadyProcessed = tickets.some((t) => t.transactionId);
      if (alreadyProcessed) {
        throw new AppError('Some tickets already processed', 409, {
          code: 'DUPLICATE_TRANSACTION',
        });
      }

      // Calculate expected amount
      const expectedAmount = tickets.reduce(
        (sum, ticket) => sum + ticket.price,
        0
      );
      if (amount !== expectedAmount) {
        throw new AppError('Payment amount mismatch', 400, {
          expected: expectedAmount,
          received: amount,
          code: 'AMOUNT_MISMATCH',
        });
      }

      // Update tickets and link to event
      const updatePromises = tickets.map((ticket) =>
        Ticket.updateOne(
          { _id: ticket._id },
          {
            $set: {
              paymentStatus: 'confirmed',
              transactionId,
              paymentMethod,
              updatedAt: new Date(),
            },
          }
        ).session(session)
      );

      // Update event ticket counts
      const eventId = tickets[0].event;
      const eventUpdate = Event.updateOne(
        { _id: eventId },
        { $inc: { 'ticketTypes.$[elem].sold': 1 } },
        {
          arrayFilters: [{ 'elem.name': { $in: tickets.map((t) => t.tier) } }],
          session,
        }
      );

      await Promise.all([...updatePromises, eventUpdate]);

      // Create payment record (optional)
      const paymentRecord = new Payment({
        transactionId,
        amount,
        currency,
        paymentMethod,
        tickets: ticketIds,
        customer: {
          email: customer?.email,
          phone: customer?.phone,
        },
        status: 'completed',
      });

      await paymentRecord.save({ session });

      await session.commitTransaction();

      logger.info('Payment processed successfully', {
        transactionId,
        ticketCount: tickets.length,
        amount,
      });
    } else if (status === 'failed') {
      // Handle failed payments
      await Ticket.updateMany(
        { _id: { $in: ticketIds } },
        {
          $set: {
            paymentStatus: 'failed',
            transactionId,
            updatedAt: new Date(),
          },
        }
      ).session(session);

      await session.commitTransaction();

      logger.warn('Payment failed', { transactionId });
    }

    // 6. Always acknowledge receipt
    res.status(200).json({
      acknowledged: true,
      timestamp: new Date().toISOString(),
      transactionId,
      ticketCount: ticketIds.length,
    });
  } catch (err) {
    await session.abortTransaction();

    logger.error('Payment webhook processing failed', {
      error: err.message,
      stack: err.stack,
      transactionId: req.body?.transactionId,
      code: err.code || 'UNKNOWN_ERROR',
    });

    next(err);
  } finally {
    session.endSession();
  }
};
