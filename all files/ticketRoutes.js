const express = require('express');
const router = express.Router();
const { AppError } = require('../middleware/errorHandler');
const Ticket = require('../models/Ticket');
const Event = require('../models/Event');
const User = require('../models/User');
const QRCode = require('qrcode');
const auth = require('../middleware/auth'); // Added missing import
const staffAuth = require('../middleware/staffAuth'); // Added missing import
const { handlePaymentWebhook } = require('../controllers/paymentWebhooks'); // Added missing import
const { processRefund } = require('../controllers/refundController');

// Helper function for ownership validation
const validateTicketOwnership = (ticket, userId, logger) => {
  if (!ticket) {
    logger.error('Ticket not found');
    throw new AppError('Ticket not found', 404, { severity: 'high' });
  }
  if (ticket.owner.toString() !== userId.toString()) {
    logger.warn('Ownership validation failed', {
      expectedOwner: ticket.owner,
      attemptingUser: userId,
    });
    throw new AppError('You do not own this ticket', 403);
  }
};

// ✅ Purchase Ticket (Working)
router.post('/purchase', auth, async (req, res, next) => {
  try {
    req.logger.info('Purchase initiated', {
      userId: req.user.id,
      eventId: req.body.eventId,
    });

    // Validate input
    if (!req.body.eventId) {
      throw new AppError('eventId is required', 400, { received: req.body });
    }

    const event = await Event.findById(req.body.eventId);
    if (!event) {
      req.logger.error('Event not found', { eventId: req.body.eventId });
      throw new AppError('Event not found', 404);
    }

    // Process ticket
    const tier = req.body.tier || 'General';
    const price = { VIP: 500, 'Early Bird': 300, General: 200 }[tier];
    const qrData = `ESWATICKET:${event._id}:${req.user.id}:${Date.now()}`;
    const qrCode = await QRCode.toDataURL(qrData);

    const ticket = new Ticket({
      event: event._id,
      owner: req.user.id,
      price,
      tier,
      qrData,
      qrCode,
      transferHistory: [
        {
          from: req.user.id,
          to: req.user.id,
          date: new Date(),
        },
      ],
    });

    await ticket.save();
    req.logger.info('Purchase completed', { ticketId: ticket._id });

    // Prepare response
    const response = ticket.toObject();
    delete response.transferHistory;
    res.status(201).json(response);
  } catch (err) {
    req.logger.error('Purchase failed', {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
});

// ✅ Get User Tickets (Working)
router.get('/my-tickets', auth, async (req, res, next) => {
  try {
    req.logger.debug('Fetching user tickets', { userId: req.user.id });

    const tickets = await Ticket.find({ owner: req.user.id })
      .populate('event', 'name date location')
      .select('-transferHistory');

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

// ✅ Transfer Ticket (Working)
router.post('/transfer/:ticketId', auth, async (req, res, next) => {
  try {
    req.logger.info('Transfer initiated', {
      ticketId: req.params.ticketId,
      sender: req.user.id,
    });

    if (!req.body.email) {
      throw new AppError('Recipient email is required', 400);
    }

    const ticket = await Ticket.findById(req.params.ticketId);
    validateTicketOwnership(ticket, req.user.id, req.logger);

    const recipient = await User.findOne({ email: req.body.email });
    if (!recipient) {
      req.logger.warn('Recipient not found', { email: req.body.email });
      throw new AppError('Recipient not found', 404);
    }

    // Generate new QR code
    const qrData = `ESWATICKET:${ticket.event}:${recipient._id}:${Date.now()}`;
    const qrCode = await QRCode.toDataURL(qrData);

    // Update ticket
    ticket.transferHistory.push({
      from: req.user.id,
      to: recipient._id,
      date: new Date(),
    });
    ticket.owner = recipient._id;
    ticket.qrData = qrData;
    ticket.qrCode = qrCode;

    await ticket.save();
    req.logger.info('Transfer completed', {
      ticketId: ticket._id,
      newOwner: recipient.email,
    });

    res.json({
      success: true,
      message: `Ticket transferred to ${recipient.email}`,
      newQRCode: qrCode,
    });
  } catch (err) {
    req.logger.error('Transfer failed', {
      ticketId: req.params.ticketId,
      error: err.message,
    });
    next(err);
  }
});

// ✅ Validate Ticket (Working)
router.post('/validate', staffAuth, async (req, res, next) => {
  try {
    req.logger.info('Validation attempt', {
      validator: req.user.id,
      qrData: req.body.qrData ? `${req.body.qrData.substring(0, 20)}...` : null,
    });

    if (!req.body.qrData) {
      throw new AppError('QR code data is required', 400);
    }

    let qrPayload;
    if (req.body.qrData.includes('ESWATICKET')) {
      qrPayload = req.body.qrData.split('ESWATICKET:')[1]
        ? `ESWATICKET:${req.body.qrData.split('ESWATICKET:')[1]}`
        : req.body.qrData;
    } else {
      const match = req.body.qrData.match(/ESWATICKET:[^"]+/);
      if (!match) {
        throw new AppError('Invalid QR code format', 400);
      }
      qrPayload = match[0];
    }

    const ticket = await Ticket.findOne({
      $or: [{ qrData: qrPayload }, { qrCode: { $regex: qrPayload } }],
    })
      .populate('event', 'name date location')
      .populate('owner', 'email');

    if (!ticket) {
      req.logger.warn('Invalid ticket scanned', { qrPayload });
      throw new AppError('Ticket not found', 404);
    }

    if (ticket.isUsed) {
      req.logger.warn('Duplicate scan attempt', {
        ticketId: ticket._id,
        firstUsed: ticket.updatedAt,
      });
      throw new AppError('Ticket already used', 400);
    }

    ticket.isUsed = true;
    ticket.validationHistory.push({
      timestamp: new Date(),
      validatedBy: req.user.id,
      location: req.body.location || 'Unknown',
    });

    await ticket.save();
    req.logger.info('Validation successful', { ticketId: ticket._id });

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
    req.logger.error('Validation failed', {
      validator: req.user.id,
      error: err.message,
    });
    next(err);
  }
});

// ✅ Payment Webhook (Working - unchanged)
router.post(
  '/webhook/payment',
  express.raw({ type: 'application/json' }),
  handlePaymentWebhook
);
// Add after other routes
router.post('/:ticketId/refund', auth, processRefund);

router.get('/search', staffAuth, async (req, res, next) => {
  try {
    const { email, ticketId, transactionId } = req.query; // REMOVED phone

    // Validate at least one search parameter
    if (!email && !ticketId && !transactionId) {
      throw new AppError('Provide email, ticketId, or transactionId', 400);
    }

    // Find tickets by email (via owner lookup)
    let ticketQuery = {};
    if (email) {
      const user = await User.findOne({ email });
      if (!user) return res.json({ tickets: [] }); // No user = no tickets
      ticketQuery.owner = user._id;
    }

    if (ticketId) ticketQuery._id = ticketId;
    if (transactionId) ticketQuery['payment.transactionId'] = transactionId;

    const tickets = await Ticket.find(ticketQuery)
      .populate('event', 'name date')
      .populate('owner', 'email'); // REMOVED phone population

    res.json({
      tickets: tickets.map((ticket) => ({
        id: ticket._id,
        event: ticket.event,
        owner: { email: ticket.owner.email }, // Only email now
        price: ticket.price,
        status: ticket.isUsed ? 'USED' : 'ACTIVE',
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
