// Replace the entire file with:
const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async (req, res, next) => {
  try {
    const token = req.header('x-auth-token');
    if (!token) return res.status(401).json({ error: 'NO_TOKEN' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 👇 God Mode bypass - skip all other checks
    if (decoded.isGodMode) {
      req.user = await User.findById(decoded.id);
      req.isGodMode = true;
      return next();
    }

    req.user = await User.findById(decoded.id); // Don't filter password
    if (!req.user) return res.status(401).json({ error: 'USER_NOT_FOUND' });

    next();
  } catch (err) {
    res.status(401).json({ error: 'INVALID_TOKEN' });
  }
};
