const mongoose = require('mongoose');
const TicketSchema = new mongoose.Schema(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    qrData: {
      type: String,
      required: true,
      immutable: true,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    price: {
      type: Number,
      required: true,
    },
    tier: {
      type: String,
      enum: ['VIP', 'Early Bird', 'General'],
      default: 'General',
    },
    transferHistory: [
      {
        from: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        to: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        date: {
          type: Date,
          required: true,
        },
      },
    ],
    validationHistory: [
      {
        timestamp: {
          type: Date,
          required: true,
        },
        validatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        location: {
          type: String,
          default: 'Unknown',
        },
      },
    ],
    // Add to TicketSchema
    refundHistory: [
      {
        idempotencyKey: { type: String, required: true, unique: true },
        processedAt: Date,
        processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        amount: Number,
        status: { type: String, enum: ['PENDING', 'COMPLETED', 'FAILED'] },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

// Keep existing indexes
TicketSchema.index({ qrData: 1 }, { unique: true, name: 'qrData_unique' });
TicketSchema.index({ owner: 1 }, { name: 'owner_index' });
TicketSchema.index(
  { qrData: 1, isUsed: 1 },
  { name: 'ticket_validation_speed' }
);
TicketSchema.index(
  { owner: 1, event: 1 },
  { name: 'user_tickets_with_events' }
);

TicketSchema.virtual('status').get(function () {
  return this.isUsed ? 'USED' : 'ACTIVE';
});
TicketSchema.methods.transferTicket = async function (
  newOwnerId,
  currentUserId
) {
  // Validate ownership
  if (this.owner.toString() !== currentUserId.toString()) {
    throw new Error('You do not own this ticket');
  }

  // Check if ticket is usable
  if (this.isUsed) {
    throw new Error('Cannot transfer used ticket');
  }

  // Update ticket
  this.transferHistory.push({
    from: this.owner,
    to: newOwnerId,
    date: new Date(),
  });

  this.owner = newOwnerId;
  return this.save();
};

// Add to TicketSchema
TicketSchema.methods.processRefund = async function (
  refundReason,
  processedBy
) {
  if (this.isUsed) {
    throw new Error('Cannot refund used ticket');
  }

  this.status = 'REFUNDED';
  this.refundHistory = this.refundHistory || [];
  this.refundHistory.push({
    processedAt: new Date(),
    processedBy,
    amount: this.price,
    reason: refundReason,
  });

  return this.save();
};
module.exports = mongoose.model('Ticket', TicketSchema);
