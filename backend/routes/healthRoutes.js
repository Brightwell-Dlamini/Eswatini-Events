const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const logger = require('../utils/logger');

router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
  });
});

router.get('/ready', async (req, res) => {
  const checks = {
    database: false,
    memoryUsage: process.memoryUsage().rss / 1024 / 1024 + 'MB',
  };

  try {
    await mongoose.connection.db.admin().ping();
    checks.database = true;

    res.status(200).json({
      status: 'READY',
      checks,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Database health check failed', err);
    res.status(503).json({
      status: 'DOWN',
      checks,
      error: 'Database connection failed',
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;
