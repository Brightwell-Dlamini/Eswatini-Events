const express = require('express');
const auth = require('../middleware/auth.js');
const Event = require('../models/Event.js');

const router = express.Router();

// Simple test endpoint
router.get('/test', auth, (req, res) => {
  res.json({ message: 'Dashboard API connected!' });
});

module.exports = router; // Change from export default to module.exports
