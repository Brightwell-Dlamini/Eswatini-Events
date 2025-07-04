const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const Joi = require('joi');

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string()
    .min(8)
    .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])'))
    .required(),
  role: Joi.string()
    .valid('attendee', 'organizer', 'staff', 'super_admin')
    .default('attendee'),
});

const updatePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string()
    .min(8)
    .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])'))
    .required(),
});

// ✅ Register
router.post('/register', async (req, res, next) => {
  try {
    // Validate input
    const { error } = registerSchema.validate(req.body);
    if (error)
      throw new AppError(`Validation error: ${error.details[0].message}`, 400);
    req.logger.info('Registration attempt', { email: req.body.email });

    const { email, password, role } = req.body;
    // Add this right before user creation:
    if (req.body.role === 'super_admin') {
      const existingSuperAdmin = await User.findOne({ role: 'super_admin' });
      if (existingSuperAdmin) {
        throw new AppError('Super admin already exists', 400);
      }
    }

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
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new AppError('Invalid credentials', 401);
    }

    // 1. Generate access token (1h expiry)
    const accessToken = jwt.sign(
      {
        id: user._id,
        role: user.role,
        isGodMode: user.role === 'super_admin', // 👑 God Mode Flag
      },
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

// ✅ Validate
router.get('/validate', auth, (req, res) => {
  res.json({
    valid: true,
    user: {
      id: req.user._id,
      email: req.user.email,
      role: req.user.role,
    },
  });
});

// ✅ Me (Get User Info)
router.get('/me', auth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-password -__v');
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// ✅ Update Password
router.patch('/update-password', auth, async (req, res, next) => {
  try {
    const { error } = updatePasswordSchema.validate(req.body);
    if (error)
      throw new AppError(`Validation error: ${error.details[0].message}`, 400);

    const user = await User.findById(req.user.id);

    if (!(await bcrypt.compare(req.body.currentPassword, user.password))) {
      throw new AppError('Current password is incorrect', 401);
    }

    user.password = req.body.newPassword;
    await user.save();

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ✅ Logout
router.post('/logout', auth, async (req, res) => {
  const token = req.cookies.refreshToken || req.body.refreshToken;

  if (token) {
    await tokenBlacklist.create({ token });
  }

  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
  res.status(204).end();
});

// ✅ Refresh Token (Enhanced)
router.post('/refresh', async (req, res, next) => {
  try {
    // 1. Get token from cookie or body
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!refreshToken) {
      throw new AppError('Refresh token required', 400, {
        solution: 'Login again to get new tokens',
      });
    }

    // 2. Verify token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // 3. Check if user still exists
    const user = await User.findById(decoded.id);
    if (!user) {
      throw new AppError('User no longer exists', 401, {
        code: 'USER_NOT_FOUND',
      });
    }

    // 4. Generate new access token (shorter expiry)
    const newAccessToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '15m' } // Shorter than initial token
    );

    // 5. Optionally rotate refresh token (security best practice)
    const newRefreshToken = jwt.sign(
      { id: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    // 6. Set new refresh token cookie
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/auth',
    });

    // 7. Return new access token
    res.json({
      accessToken: newAccessToken,
      // Only return refreshToken in body if not using cookies
      ...(process.env.NODE_ENV === 'development' && {
        refreshToken: newRefreshToken,
      }),
    });
  } catch (err) {
    // Specific error handling
    if (err.name === 'TokenExpiredError') {
      return next(
        new AppError('Refresh token expired', 401, {
          solution: 'Please login again',
        })
      );
    }
    if (err.name === 'JsonWebTokenError') {
      return next(new AppError('Invalid token', 401));
    }
    next(err);
  }
});

module.exports = router;
