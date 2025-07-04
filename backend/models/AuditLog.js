const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: { type: String, required: true }, // e.g., "FORCE_REFUND"
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  targetId: { type: String }, // ID of affected entity (e.g., ticketId)
  metadata: { type: Object }, // Additional data (e.g., refund amount)
  ipAddress: { type: String },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
