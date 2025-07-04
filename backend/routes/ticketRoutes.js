const express = require('express');
const router = express.Router();
const Joi = require('joi');
const mongoose = require('mongoose');
const { AppError } = require('../middleware/errorHandler');
const Ticket = require('../models/Ticket');
const Event = require('../models/Event');
const User = require('../models/User');
const QRCode = require('qrcode');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const staffAuth = require('../middleware/staffAuth');
const { handlePaymentWebhook } = require('../controllers/paymentWebhooks');
const { processRefund } = require('../controllers/refundController');

// Validation Schemas
const purchaseSchema = Joi.object({
  eventId: Joi.string().hex().length(24).required(),
  tier: Joi.string().valid('VIP', 'Early Bird', 'General').default('General'),
  quantity: Joi.number().integer().min(1).max(10).default(1),
});

const transferSchema = Joi.object({
  email: Joi.string().email().required(),
});

const validateSchema = Joi.object({
  qrData: Joi.string().required(),
  location: Joi.string().max(100),
});

const batchPurchaseSchema = Joi.object({
  eventId: Joi.string().hex().length(24).required(),
  tickets: Joi.array()
    .items(
      Joi.object({
        tier: Joi.string().valid('VIP', 'Early Bird', 'General').required(),
        quantity: Joi.number().integer().min(1).max(5).default(1),
      })
    )
    .min(1)
    .max(5),
});

const searchSchema = Joi.object({
  email: Joi.string().email(),
  ticketId: Joi.string().hex().length(24),
  transactionId: Joi.string(),
}).or('email', 'ticketId', 'transactionId');

const refundSchema = Joi.object({
  reason: Joi.string().max(500).required(),
});

// Helper functions
const validateTicketOwnership = (ticket, userId, logger) => {
  if (!ticket) {
    logger.error('Ticket not found');
    throw new AppError('Ticket not found', 404, { severity: 'high' });
  }
  if (req.isGodMode) return; // 👈 God Mode bypass
  if (ticket.owner.toString() !== userId.toString()) {
    logger.warn('Ownership validation failed', {
      expectedOwner: ticket.owner,
      attemptingUser: userId,
    });
    throw new AppError('You do not own this ticket', 403);
  }
};

async function createSingleTicket(eventId, userId, tier, session = null) {
  const price = { VIP: 500, 'Early Bird': 300, General: 200 }[tier];
  const qrData = `ESWATICKET:${eventId}:${userId}:${Date.now()}`;
  const qrCode = await QRCode.toDataURL(qrData);

  const ticket = new Ticket({
    event: eventId,
    owner: userId,
    price,
    tier,
    qrData,
    qrCode,
    transferHistory: [
      {
        from: userId,
        to: userId,
        date: new Date(),
      },
    ],
  });

  const options = session ? { session } : {};
  await ticket.save(options);
  return ticket.toObject();
}

// Routes
// Purchase Ticket
router.post(
  '/purchase',
  auth,
  validate(purchaseSchema),
  async (req, res, next) => {
    try {
      req.logger.info('Purchase initiated', {
        userId: req.user.id,
        eventId: req.body.eventId,
        quantity: req.body.quantity,
      });

      if (req.body.quantity > 1) {
        // Convert to batch purchase format
        const batchPayload = {
          eventId: req.body.eventId,
          tickets: [
            {
              tier: req.body.tier,
              quantity: req.body.quantity,
            },
          ],
        };
        req.body = batchPayload;
        return next('route'); // Pass to batch purchase route
      }

      const event = await Event.findById(req.body.eventId);
      if (!event) {
        throw new AppError('Event not found', 404, {
          eventId: req.body.eventId,
          solution: 'Verify the event ID or contact support',
        });
      }

      const ticket = await createSingleTicket(
        event._id,
        req.user.id,
        req.body.tier
      );

      req.logger.info('Purchase completed', { ticketId: ticket._id });
      res.status(201).json(ticket);
    } catch (err) {
      req.logger.error('Purchase failed', {
        error: err.message,
        stack: err.stack,
        body: req.body,
      });
      next(err);
    }
  }
);

// Batch Purchase
router.post(
  '/batch-purchase',
  auth,
  validate(batchPurchaseSchema),
  async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      req.logger.info('Batch purchase initiated', {
        userId: req.user.id,
        eventId: req.body.eventId,
        ticketCount: req.body.tickets.reduce(
          (sum, item) => sum + item.quantity,
          0
        ),
      });

      const event = await Event.findById(req.body.eventId).session(session);
      if (!event) {
        throw new AppError('Event not found', 404, {
          eventId: req.body.eventId,
        });
      }

      const createdTickets = [];
      for (const item of req.body.tickets) {
        for (let i = 0; i < item.quantity; i++) {
          const ticket = await createSingleTicket(
            event._id,
            req.user.id,
            item.tier,
            session
          );
          createdTickets.push(ticket);
        }
      }

      await session.commitTransaction();
      req.logger.info('Batch purchase completed', {
        ticketCount: createdTickets.length,
        eventId: event._id,
      });

      res.status(201).json({
        success: true,
        count: createdTickets.length,
        tickets: createdTickets,
      });
    } catch (err) {
      await session.abortTransaction();
      req.logger.error('Batch purchase failed', {
        error: err.message,
        eventId: req.body.eventId,
      });
      next(err);
    } finally {
      session.endSession();
    }
  }
);

// Get User Tickets
router.get('/my-tickets', auth, async (req, res, next) => {
  try {
    req.logger.debug('Fetching user tickets', { userId: req.user.id });

    const tickets = await Ticket.find({ owner: req.user.id })
      .populate('event', 'name date location')
      .select('-transferHistory -validationHistory')
      .lean();

    req.logger.info('Tickets retrieved', { count: tickets.length });
    res.json(tickets);
  } catch (err) {
    req.logger.error('Failed to fetch tickets', {
      userId: req.user.id,
      error: err.message,
    });
    next(err);
  }
});

// Transfer Ticket
router.post(
  '/transfer/:ticketId',
  auth,
  validate(transferSchema),
  async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      req.logger.info('Transfer initiated', {
        ticketId: req.params.ticketId,
        sender: req.user.id,
        recipientEmail: req.body.email,
      });

      const ticket = await Ticket.findById(req.params.ticketId).session(
        session
      );
      validateTicketOwnership(ticket, req.user.id, req.logger);

      const recipient = await User.findOne({ email: req.body.email }).session(
        session
      );
      if (!recipient) {
        throw new AppError('Recipient not found', 404, {
          email: req.body.email,
          solution: 'Verify the email or ask recipient to register',
        });
      }

      const qrData = `ESWATICKET:${ticket.event}:${
        recipient._id
      }:${Date.now()}`;
      const qrCode = await QRCode.toDataURL(qrData);

      ticket.transferHistory.push({
        from: req.user.id,
        to: recipient._id,
        date: new Date(),
      });
      ticket.owner = recipient._id;
      ticket.qrData = qrData;
      ticket.qrCode = qrCode;

      await ticket.save({ session });
      await session.commitTransaction();

      req.logger.info('Transfer completed', {
        ticketId: ticket._id,
        newOwner: recipient.email,
      });

      res.json({
        success: true,
        message: `Ticket transferred to ${recipient.email}`,
        newQRCode: qrCode,
        ticketId: ticket._id,
      });
    } catch (err) {
      await session.abortTransaction();
      req.logger.error('Transfer failed', {
        ticketId: req.params.ticketId,
        error: err.message,
      });
      next(err);
    } finally {
      session.endSession();
    }
  }
);

// Validate Ticket
router.post(
  '/validate',
  staffAuth,
  validate(validateSchema),
  async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      req.logger.info('Validation attempt', {
        validator: req.user.id,
        location: req.body.location,
      });

      let qrPayload;
      if (req.body.qrData.includes('ESWATICKET')) {
        qrPayload = req.body.qrData.split('ESWATICKET:')[1]
          ? `ESWATICKET:${req.body.qrData.split('ESWATICKET:')[1]}`
          : req.body.qrData;
      } else {
        const match = req.body.qrData.match(/ESWATICKET:[^"]+/);
        if (!match) {
          throw new AppError('Invalid QR code format', 400, {
            solution: 'Scan a valid Eswatini Ticket QR code',
          });
        }
        qrPayload = match[0];
      }

      const ticket = await Ticket.findOne({
        $or: [{ qrData: qrPayload }, { qrCode: { $regex: qrPayload } }],
      })
        .populate('event', 'name date location')
        .populate('owner', 'email')
        .session(session);

      if (!ticket) {
        throw new AppError('Ticket not found', 404, {
          qrPayload: qrPayload.substring(0, 50),
          solution: 'Verify the ticket or contact support',
        });
      }

      if (ticket.isUsed) {
        throw new AppError('Ticket already used', 400, {
          ticketId: ticket._id,
          firstUsed: ticket.updatedAt,
          solution: 'Check for duplicate scanning',
        });
      }

      ticket.isUsed = true;
      ticket.validationHistory.push({
        timestamp: new Date(),
        validatedBy: req.user.id,
        location: req.body.location || 'Unknown',
      });

      await ticket.save({ session });
      await session.commitTransaction();

      req.logger.info('Validation successful', {
        ticketId: ticket._id,
        event: ticket.event.name,
      });

      res.json({
        valid: true,
        event: {
          id: ticket.event._id,
          name: ticket.event.name,
          date: ticket.event.date,
          location: ticket.event.location,
        },
        attendee: {
          email: ticket.owner.email,
        },
        validatedAt: new Date(),
      });
    } catch (err) {
      await session.abortTransaction();
      req.logger.error('Validation failed', {
        validator: req.user.id,
        error: err.message,
      });
      next(err);
    } finally {
      session.endSession();
    }
  }
);

// Refund Ticket
router.post(
  '/:ticketId/refund',
  auth,
  validate(refundSchema),
  require('../middleware/idempotency'),
  processRefund
);

// Search Tickets
router.get(
  '/search',
  staffAuth,
  validate(searchSchema, { query: true }),
  async (req, res, next) => {
    try {
      req.logger.info('Ticket search initiated', {
        searcher: req.user.id,
        query: req.query,
      });

      let ticketQuery = {};
      if (req.query.email) {
        const user = await User.findOne({ email: req.query.email });
        if (!user) return res.json({ tickets: [] });
        ticketQuery.owner = user._id;
      }

      if (req.query.ticketId) ticketQuery._id = req.query.ticketId;
      if (req.query.transactionId)
        ticketQuery['payment.transactionId'] = req.query.transactionId;

      const tickets = await Ticket.find(ticketQuery)
        .populate('event', 'name date')
        .populate('owner', 'email')
        .lean();

      req.logger.info('Search completed', { resultCount: tickets.length });
      res.json({ tickets });
    } catch (err) {
      req.logger.error('Search failed', {
        error: err.message,
        query: req.query,
      });
      next(err);
    }
  }
);

// Webhook for Payment Processing
router.post(
  '/webhook/payment',
  express.raw({ type: 'application/json' }),
  handlePaymentWebhook
);
module.exports = router;
