const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    date: {
      type: Date,
      required: true,
      index: true, // Frequently filtered
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true, // Optimized for filtering
    },
    location: {
      venue: String,
      gps: {
        type: String,
        validate: {
          validator: (v) => /^-?\d+\.\d+,-?\d+\.\d+$/.test(v),
          message: (props) => `${props.value} is not valid GPS coordinates!`,
        },
      },
    },
    // In EventSchema (add after 'location')
    ticketTypes: {
      type: [
        {
          name: { type: String, required: true }, // e.g. "VIP", "Early Bird"
          price: { type: Number, required: true },
          capacity: { type: Number, required: true },
          available: { type: Number }, // Auto-calculated
        },
      ],
      validate: {
        validator: (v) => v.length > 0,
        message: 'At least one ticket type is required',
      },
    },
    organizer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Core Indexes (Phase 2)
EventSchema.index({ organizer: 1 }, { name: 'organizer_index' });

// Performance Indexes (Phase 3)
EventSchema.index(
  { isActive: 1, date: 1 },
  {
    name: 'active_events_sorted',
    partialFilterExpression: { isActive: true },
  }
);

// Geospatial Index (for location-based queries)
EventSchema.index(
  { 'location.gps': '2dsphere' },
  { name: 'event_location_geo' }
);

module.exports = mongoose.model('Event', EventSchema);
