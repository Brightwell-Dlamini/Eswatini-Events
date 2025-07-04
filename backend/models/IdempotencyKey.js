const mongoose = require('mongoose');

const IdempotencyKeySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    requestMethod: String,
    requestPath: String,
    responseStatusCode: Number,
    responseBody: mongoose.Schema.Types.Mixed,
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h TTL
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('IdempotencyKey', IdempotencyKeySchema);
