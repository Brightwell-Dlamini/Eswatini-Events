const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true, // Now strictly required
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Invalid email'],
  },

  password: {
    type: String,
    required: true,
    minlength: 8,
  },
  role: {
    type: String,
    enum: ['attendee', 'staff', 'organizer', 'super_admin'],
    default: 'attendee',
  },

  name: {
    type: String,
    trim: true,
    maxlength: 50,
  },
});

// Core Indexes (Phase 2)
UserSchema.index(
  { email: 1 },
  {
    unique: true,
    name: 'email_unique',
    collation: { locale: 'en', strength: 2 }, // Case-insensitive
  }
);

UserSchema.index({ role: 1 }, { name: 'role_index' });

// Password hashing
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  if (this.isModified('role') && this.role === 'super_admin' && !this.isNew) {
    throw new Error('Cannot modify roles to super_admin');
  }
  next();
});

module.exports = mongoose.model('User', UserSchema);
