const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const { audit } = require('../utils/audit');
const {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  verifyRefreshToken,
} = require('../services/tokenService');
const { ROLE_DEFAULT_PERMISSIONS } = require('../config/constants');
const logger = require('../config/logger');

// ─── Login ────────────────────────────────────────────────────────────────
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email, isDeleted: false }).select(
    '+password +loginAttempts +lockUntil +refreshTokenHash'
  );

  // Account locked
  if (user?.isLocked) {
    const minutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
    await audit(req, { action: 'login_failed', entity: 'User', entityId: user._id, meta: { reason: 'locked' }, status: 'failure' });
    return res.status(423).json({
      success: false,
      message: `Account locked due to multiple failed attempts. Try again in ${minutes} minute(s).`,
    });
  }

  if (!user || !(await user.matchPassword(password))) {
    if (user) await user.incLoginAttempts();
    await audit(req, { action: 'login_failed', entity: 'User', entityId: user?._id, meta: { email }, status: 'failure' });
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  if (!user.isActive) {
    return res.status(401).json({ success: false, message: 'Account is deactivated. Contact an administrator.' });
  }

  // Success — reset attempts
  const ip = req.ip || req.headers['x-forwarded-for'];
  await user.resetLoginAttempts(ip);

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken();
  const refreshHash = await hashToken(refreshToken);

  // Store hashed refresh token
  await User.findByIdAndUpdate(user._id, { refreshTokenHash: refreshHash });

  await audit(req, { action: 'login', entity: 'User', entityId: user._id });

  logger.info(`User logged in: ${user.email}`);

  res.json({
    success: true,
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        restrictedFeatures: user.restrictedFeatures,
      },
      accessToken,
      refreshToken,
    },
  });
});

// ─── Refresh Token ────────────────────────────────────────────────────────
exports.refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw new AppError('Refresh token required.', 400);
  }

  // We don't know which user without a user ID; client should also send userId
  // Better pattern: store a mapping. For simplicity, scan (small user base)
  // In production: store refresh token with userId reference in Redis or a TokenStore model
  const { userId } = req.body;
  if (!userId) throw new AppError('User ID required.', 400);

  const user = await User.findById(userId).select('+refreshTokenHash');
  if (!user || !user.refreshTokenHash) {
    throw new AppError('Invalid or expired refresh token.', 401);
  }

  const isValid = await verifyRefreshToken(refreshToken, user.refreshTokenHash);
  if (!isValid) {
    // Possible token theft — clear stored token
    await User.findByIdAndUpdate(userId, { $unset: { refreshTokenHash: 1 } });
    throw new AppError('Invalid refresh token. Please log in again.', 401);
  }

  if (!user.isActive || user.isDeleted) {
    throw new AppError('Account is not accessible.', 401);
  }

  // Issue new pair (rotate)
  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken();
  const newHash = await hashToken(newRefreshToken);
  await User.findByIdAndUpdate(userId, { refreshTokenHash: newHash });

  res.json({
    success: true,
    data: { accessToken: newAccessToken, refreshToken: newRefreshToken },
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────
exports.logout = asyncHandler(async (req, res) => {
  // Invalidate refresh token
  await User.findByIdAndUpdate(req.user._id, { $unset: { refreshTokenHash: 1 } });
  await audit(req, { action: 'logout', entity: 'User', entityId: req.user._id });
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ─── Register (admin only) ────────────────────────────────────────────────
exports.register = asyncHandler(async (req, res) => {
  const { name, email, password, role, permissions } = req.body;

  const userExists = await User.findOne({ email });
  if (userExists) {
    throw new AppError('A user with this email already exists.', 409);
  }

  // Default permissions from role, but allow override
  const finalPermissions = permissions || ROLE_DEFAULT_PERMISSIONS[role] || [];

  const user = await User.create({
    name,
    email,
    password,
    role,
    permissions: finalPermissions,
    createdBy: req.user._id,
  });

  await audit(req, {
    action: 'create',
    entity: 'User',
    entityId: user._id,
    meta: { role, email },
  });

  logger.info(`New user created: ${email} by ${req.user.email}`);

  res.status(201).json({
    success: true,
    message: 'User created successfully.',
    data: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
    },
  });
});

// ─── Change Password ──────────────────────────────────────────────────────
exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select('+password');
  if (!user) throw new AppError('User not found.', 404);

  const isMatch = await user.matchPassword(currentPassword);
  if (!isMatch) throw new AppError('Current password is incorrect.', 400);

  user.password = newPassword;
  await user.save();

  // Invalidate refresh tokens (force re-login on other devices)
  await User.findByIdAndUpdate(user._id, { $unset: { refreshTokenHash: 1 } });

  await audit(req, { action: 'update', entity: 'User', entityId: user._id, meta: { action: 'password_change' } });

  res.json({ success: true, message: 'Password changed successfully. Please log in again.' });
});

// ─── Get Current User ─────────────────────────────────────────────────────
exports.getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('createdBy', 'name email');
  if (!user) throw new AppError('User not found.', 404);
  res.json({ success: true, data: user });
});
