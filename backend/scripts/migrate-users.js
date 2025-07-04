const mongoose = require('mongoose');
const User = require('../models/User');

async function migrate() {
  // Find users with neither email nor phone
  const invalidUsers = await User.find({
    $or: [
      { email: { $exists: false } },
      { email: null },
      { phone: { $exists: false } },
      { phone: null },
    ],
  });

  // Add placeholder email if missing
  for (const user of invalidUsers) {
    if (!user.email && !user.phone) {
      user.email = `placeholder_${user._id}@example.com`;
      await user.save();
    }
  }
}

migrate().then(() => process.exit());
