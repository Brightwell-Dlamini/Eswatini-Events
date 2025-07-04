const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { AppError } = require('../middleware/errorHandler');

// ✅ Register
router.post('/register', async (req, res, next) => {
  try {
    req.logger.info('Registration attempt', { email: req.body.email });

    const { email, password, role } = req.body;

    // Validate email (now the only identifier)
    if (!email) {
      throw new AppError('Email is required', 400);
    }

    // Check for existing user by email only
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new AppError('Email already exists', 400);
    }

    // Create user with email only
    const user = await User.create({ email, password, role });

    req.logger.info('User registered', { userId: user._id });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(201).json({ token });
  } catch (err) {
    req.logger.error('Registration error', { error: err.message });
    next(err);
  }
});

// ✅ Login
router.post('/login', async (req, res, next) => {
  console.log('Cookies:', req.cookies); // Should show existing cookies
  console.log('Headers:', req.headers.cookie); // Raw cookie header
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new AppError('Invalid credentials', 401);
    }

    // 1. Generate access token (1h expiry)
    const accessToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // 2. Generate refresh token (7d expiry)
    const refreshToken = jwt.sign(
      { id: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    // 3. Store refresh token in HTTP-only cookie
    // In login endpoint
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: false, // Disable in development for Postman
      sameSite: 'lax', // More flexible than 'strict'
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth', // Only send for auth routes
    });

    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
});

// ✅ Refresh Token (New)
router.post('/refresh', async (req, res, next) => {
  try {
    // Debug logging
    req.logger.info('Refresh attempt', {
      cookies: req.cookies,
      headers: req.headers,
    });

    const refreshToken =
      req.cookies?.refreshToken || req.headers['x-refresh-token'];
    if (!refreshToken) {
      req.logger.warn('No refresh token found');
      return res.status(401).json({ error: 'Missing refresh token' });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) throw new AppError('User not found', 404);

    // Issue new access token
    const newAccessToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ accessToken: newAccessToken });
  } catch (err) {
    req.logger.error('Refresh failed', { error: err.message });
    next(err);
  }
});

// ✅ Logout (New)
router.post('/logout', (req, res) => {
  res.clearCookie('refreshToken');
  res.status(204).end();
});

module.exports = router;
