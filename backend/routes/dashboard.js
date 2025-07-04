const express = require('express');
const router = express.Router();
const Event = require('../models/Event');
const Ticket = require('../models/Ticket');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { AppError } = require('../middleware/errorHandler');
const Joi = require('joi');

const dashboardSchema = Joi.object({
  eventId: Joi.string().hex().length(24),
  timeframe: Joi.string().valid('day', 'week', 'month', 'all').default('week'),
});

// GET /api/dashboard/summary - Organizer dashboard summary
router.get(
  '/summary',
  auth,
  validate(dashboardSchema, { query: true }),
  async (req, res, next) => {
    try {
      const { eventId, timeframe } = req.query;

      // Only organizers can access this endpoint
      if (req.user.role !== 'organizer') {
        throw new AppError('Organizer access required', 403);
      }

      const match = { organizer: req.user.id };
      if (eventId) {
        match._id = eventId;
      }

      const events = await Event.find(match).select('_id name date');

      if (events.length === 0) {
        return res.json({
          events: [],
          summary: {
            totalSales: 0,
            totalTickets: 0,
            attendanceRate: 0,
            upcomingEvents: 0,
          },
        });
      }

      const eventIds = events.map((e) => e._id);

      // Calculate date range based on timeframe
      let dateRange = {};
      if (timeframe !== 'all') {
        const now = new Date();
        dateRange.createdAt = { $gte: new Date() };

        if (timeframe === 'day') {
          dateRange.createdAt.$gte.setDate(now.getDate() - 1);
        } else if (timeframe === 'week') {
          dateRange.createdAt.$gte.setDate(now.getDate() - 7);
        } else if (timeframe === 'month') {
          dateRange.createdAt.$gte.setMonth(now.getMonth() - 1);
        }
      }

      // Get ticket statistics
      const ticketStats = await Ticket.aggregate([
        { $match: { event: { $in: eventIds }, ...dateRange } },
        {
          $group: {
            _id: null,
            totalSales: { $sum: '$price' },
            totalTickets: { $sum: 1 },
            usedTickets: {
              $sum: { $cond: [{ $eq: ['$isUsed', true] }, 1, 0] },
            },
          },
        },
      ]);

      const stats = ticketStats[0] || {
        totalSales: 0,
        totalTickets: 0,
        usedTickets: 0,
      };

      // Count upcoming events
      const upcomingEvents = await Event.countDocuments({
        organizer: req.user.id,
        date: { $gte: new Date() },
      });

      res.json({
        events,
        summary: {
          totalSales: stats.totalSales,
          totalTickets: stats.totalTickets,
          attendanceRate:
            stats.totalTickets > 0
              ? Math.round((stats.usedTickets / stats.totalTickets) * 100)
              : 0,
          upcomingEvents,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
