const express = require('express');
const router = express.Router();
const Event = require('../models/Event');
const auth = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

// ✅ Create Event
router.post('/', auth, async (req, res, next) => {
  try {
    req.logger.info('Event creation attempt', {
      userId: req.user.id,
      eventData: req.body,
    });

    if (!['organizer', 'super_admin'].includes(req.user.role)) {
      req.logger.warn('Unauthorized event creation attempt', {
        userId: req.user.id,
        role: req.user.role,
      });
      throw new AppError('Not authorized to create events', 403);
    }

    const event = new Event({
      ...req.body,
      organizer: req.user.id,
    });

    await event.save();

    req.logger.info('Event created', {
      eventId: event._id,
      name: event.name,
    });

    res.status(201).json(event);
  } catch (err) {
    req.logger.error('Event creation failed', {
      error: err.message,
      userId: req.user.id,
    });
    next(err);
  }
});

// Phase 1, Step 1: Get Active Events
router.get('/active', async (req, res, next) => {
  try {
    const events = await Event.find({ isActive: true })
      .sort({ date: 1 }) // Soonest first
      .select('name date location ticketTypes'); // Only needed fields

    res.json({ events });
  } catch (err) {
    next(err); // Pass errors to errorHandler
  }
});

module.exports = router;
