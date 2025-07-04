const mongoose = require('mongoose');

module.exports = function () {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB Atlas connected'))
    .catch((err) => console.error('MongoDB connection error:', err));

  // Add to db.js for robust connection handling
  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected! Attempting reconnect...');
    mongoose.connect(process.env.MONGODB_URI);
  });
};
