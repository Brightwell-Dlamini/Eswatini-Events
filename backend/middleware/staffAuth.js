const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async (req, res, next) => {
  try {
    // 1. Get token from header
    const token = req.header('x-auth-token');
    if (!token) {
      return res.status(401).json({ error: 'No authentication token' });
    }

    // 2. Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. Check if user is staff/admin
    const user = await User.findById(decoded.id);
    if (!['staff', 'super_admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Staff access only' });
    }

    // 4. Attach user to request
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid authentication token' });
  }
};
