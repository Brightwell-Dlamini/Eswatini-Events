const express = require('express');
const router = express.Router();
const Event = require('../models/Event');
const auth = require('../middleware/auth');
const Ticket = require('../models/Ticket');
const { AppError } = require('../middleware/errorHandler');
const Joi = require('joi');
const mongoose = require('mongoose');

// Validation schemas
const eventSchema = Joi.object({
  name: Joi.string().required().max(100),
  date: Joi.date().required().greater('now'),
  isActive: Joi.boolean().default(true),
  location: Joi.object({
    venue: Joi.string().required(),
    address: Joi.string(),
    coordinates: Joi.array().items(Joi.number()).length(2),
  }).required(),
  ticketTypes: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().required(),
        price: Joi.number().required().min(0),
        capacity: Joi.number().required().min(1),
      })
    )
    .min(1)
    .required(),
});

const updateEventSchema = Joi.object({
  name: Joi.string().max(100),
  date: Joi.date().greater('now'),
  isActive: Joi.boolean(),
  location: Joi.object({
    venue: Joi.string(),
    address: Joi.string(),
    coordinates: Joi.array().items(Joi.number()).length(2),
  }),
  ticketTypes: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().required(),
        price: Joi.number().required().min(0),
        capacity: Joi.number().required().min(1),
      })
    )
    .min(1),
}).min(1);

// Middleware to check event ownership
const checkEventOwnership = async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      throw new AppError('Event not found', 404);
    }

    // Super admin bypasses ownership check
    if (req.isGodMode) return next(); // 👈 God Mode bypass

    // Organizer must own the event
    if (event.organizer.toString() !== req.user.id.toString()) {
      throw new AppError('Not authorized to access this event', 403);
    }

    req.event = event;
    next();
  } catch (err) {
    next(err);
  }
};

// Create Event
router.post('/', auth, async (req, res, next) => {
  try {
    // Only organizers and super admins can create events
    if (!['organizer', 'super_admin'].includes(req.user.role)) {
      throw new AppError('Only organizers can create events', 403);
    }

    const { error } = eventSchema.validate(req.body);
    if (error) {
      throw new AppError(`Validation error: ${error.details[0].message}`, 400);
    }

    const event = new Event({
      ...req.body,
      organizer: req.user.id,
    });

    await event.save();
    res.status(201).json(event);
  } catch (err) {
    next(err);
  }
});

// Get Active Events (public)
router.get('/active', async (req, res, next) => {
  try {
    const events = await Event.find({ isActive: true })
      .sort({ date: 1 })
      .select('name date location ticketTypes organizer')
      .populate('organizer', 'name email');

    res.json({ events });
  } catch (err) {
    next(err);
  }
});

// Get Event by ID
router.get('/:id', auth, async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id).populate(
      'organizer',
      'name email'
    );

    if (!event) {
      throw new AppError('Event not found', 404);
    }

    // Only show inactive events to staff/admin or the organizer
    if (
      !event.isActive &&
      !['staff', 'super_admin'].includes(req.user.role) &&
      event.organizer._id.toString() !== req.user.id.toString()
    ) {
      throw new AppError('Event not available', 404);
    }

    res.json(event);
  } catch (err) {
    next(err);
  }
});

// Update Event
router.patch('/:id', auth, checkEventOwnership, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { error } = updateEventSchema.validate(req.body);
    if (error) {
      throw new AppError(`Validation error: ${error.details[0].message}`, 400);
    }

    // Prevent changing organizer unless super admin
    if (req.body.organizer && req.user.role !== 'super_admin') {
      throw new AppError('Only super admin can change event organizer', 403);
    }

    const updates = Object.keys(req.body);
    const allowedUpdates = [
      'name',
      'date',
      'isActive',
      'location',
      'ticketTypes',
    ];
    const isValidOperation = updates.every((update) =>
      allowedUpdates.includes(update)
    );

    if (!isValidOperation) {
      throw new AppError('Invalid updates!', 400);
    }

    const event = req.event;
    updates.forEach((update) => (event[update] = req.body[update]));
    await event.save({ session });

    await session.commitTransaction();
    res.json(event);
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
});

// Delete Event
router.delete('/:id', auth, checkEventOwnership, async (req, res, next) => {
  try {
    // Only super admin can delete events
    if (req.user.role !== 'super_admin') {
      throw new AppError('Only super admin can delete events', 403);
    }

    await req.event.remove();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Get Tickets for Event
router.get(
  '/:id/tickets',
  auth,
  checkEventOwnership,
  async (req, res, next) => {
    try {
      // Only staff and above can view event tickets
      if (!['staff', 'organizer', 'super_admin'].includes(req.user.role)) {
        throw new AppError('Not authorized to view event tickets', 403);
      }

      const tickets = await Ticket.find({ event: req.params.id })
        .populate('owner', 'email name')
        .select('-qrData -transferHistory -validationHistory');

      res.json({ tickets });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
