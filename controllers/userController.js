const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const { audit, diff } = require('../utils/audit');
const { paginate } = require('../utils/paginate');
const { ROLE_DEFAULT_PERMISSIONS } = require('../config/constants');

// ─── Get All Users ─────────────────────────────────────────────────────────
exports.getUsers = asyncHandler(async (req, res) => {
  const { page, limit, sort, search, role, isActive } = req.query;

  const filter = { 
    isDeleted: false,
    role: { $ne: 'admin' } // Exclude admin users
  };
  
  if (role) filter.role = role;
  if (isActive !== undefined) filter.isActive = isActive === 'true';
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const result = await paginate(
    User,
    filter,
    { page, limit, sort: sort || '-createdAt', select: '-password -refreshTokenHash' },
    { path: 'createdBy', select: 'name email' }
  );

  res.json({ success: true, ...result });
});
// ─── Get Single User ───────────────────────────────────────────────────────
exports.getUserById = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, isDeleted: false })
    .select('-password -refreshTokenHash')
    .populate('createdBy', 'name email');

  if (!user) throw new AppError('User not found.', 404);
  res.json({ success: true, data: user });
});

// ─── Update User Role & Permissions ───────────────────────────────────────
exports.updateUser = asyncHandler(async (req, res) => {
  const { role, permissions, name, email, restrictedFeatures } = req.body;

  const user = await User.findOne({ _id: req.params.id, isDeleted: false });
  if (!user) throw new AppError('User not found.', 404);

  // Prevent modifying another admin (only the same admin can change themselves)
  if (user.role === 'admin' && req.user._id.toString() !== user._id.toString()) {
    throw new AppError('Cannot modify another administrator.', 403);
  }

  const before = { role: user.role, permissions: [...user.permissions], restrictedFeatures: [...user.restrictedFeatures] };

  if (name) user.name = name;
  if (email) user.email = email;
  if (role) {
    user.role = role;
    // Reset to role defaults if permissions not explicitly provided
    if (!permissions) user.permissions = ROLE_DEFAULT_PERMISSIONS[role] || [];
  }
  if (permissions) user.permissions = permissions;
  if (restrictedFeatures !== undefined) user.restrictedFeatures = restrictedFeatures;
  user.updatedBy = req.user._id;

  await user.save();

  const changes = diff(before, { role: user.role, permissions: user.permissions, restrictedFeatures: user.restrictedFeatures });

  await audit(req, {
    action: 'role_change',
    entity: 'User',
    entityId: user._id,
    changes,
  });

  res.json({
    success: true,
    message: 'User updated successfully.',
    data: user,
  });
});

// ─── Deactivate User ──────────────────────────────────────────────────────
exports.deactivateUser = asyncHandler(async (req, res) => {
  if (req.params.id === req.user._id.toString()) {
    throw new AppError('You cannot deactivate your own account.', 400);
  }

  const user = await User.findOne({ _id: req.params.id, isDeleted: false });
  if (!user) throw new AppError('User not found.', 404);
  if (user.role === 'admin') throw new AppError('Cannot deactivate another admin.', 403);
  if (!user.isActive) throw new AppError('User is already deactivated.', 400);

  user.isActive = false;
  user.deactivatedAt = new Date();
  user.deactivatedBy = req.user._id;
  // Invalidate refresh token immediately
  user.refreshTokenHash = undefined;
  await user.save();

  await audit(req, { action: 'deactivate', entity: 'User', entityId: user._id });

  res.json({ success: true, message: 'User deactivated successfully.' });
});

// ─── Activate User ────────────────────────────────────────────────────────
exports.activateUser = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, isDeleted: false });
  if (!user) throw new AppError('User not found.', 404);
  if (user.isActive) throw new AppError('User is already active.', 400);

  user.isActive = true;
  user.deactivatedAt = undefined;
  user.deactivatedBy = undefined;
  user.loginAttempts = 0;
  user.lockUntil = undefined;
  await user.save();

  await audit(req, { action: 'activate', entity: 'User', entityId: user._id });

  res.json({ success: true, message: 'User activated successfully.' });
});

// ─── Reset User Password (admin) ──────────────────────────────────────────
exports.resetUserPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    throw new AppError('New password must be at least 8 characters.', 400);
  }

  const user = await User.findOne({ _id: req.params.id, isDeleted: false });
  if (!user) throw new AppError('User not found.', 404);

  user.password = newPassword;
  user.refreshTokenHash = undefined;
  user.loginAttempts = 0;
  user.lockUntil = undefined;
  await user.save();

  await audit(req, { action: 'update', entity: 'User', entityId: user._id, meta: { action: 'admin_password_reset' } });

  res.json({ success: true, message: 'Password reset successfully.' });
});

// ─── Restrict / Unrestrict Feature ────────────────────────────────────────
exports.updateFeatureRestrictions = asyncHandler(async (req, res) => {
  const { restrictedFeatures } = req.body;

  if (!Array.isArray(restrictedFeatures)) {
    throw new AppError('restrictedFeatures must be an array.', 400);
  }

  const user = await User.findOne({ _id: req.params.id, isDeleted: false });
  if (!user) throw new AppError('User not found.', 404);
  if (user.role === 'admin') throw new AppError('Cannot restrict an admin.', 403);

  const before = [...user.restrictedFeatures];
  user.restrictedFeatures = restrictedFeatures;
  await user.save();

  await audit(req, {
    action: 'feature_restrict',
    entity: 'User',
    entityId: user._id,
    changes: { restrictedFeatures: { before, after: restrictedFeatures } },
  });

  res.json({ success: true, message: 'Feature restrictions updated.', data: { restrictedFeatures } });
});

// ─── Get Audit Logs ────────────────────────────────────────────────────────
exports.getAuditLogs = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, userId, entity, action, startDate, endDate } = req.query;

  const filter = {};
  if (userId) filter.user = userId;
  if (entity) filter.entity = entity;
  if (action) filter.action = action;
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  const result = await paginate(AuditLog, filter, { page, limit, sort: '-createdAt' }, {
    path: 'user',
    select: 'name email role',
  });

  res.json({ success: true, ...result });
});

// ─── Delete User (soft delete) ─────────────────────────────────────────────
exports.deleteUser = asyncHandler(async (req, res) => {
  if (req.params.id === req.user._id.toString()) {
    throw new AppError('You cannot delete your own account.', 400);
  }

  const user = await User.findOne({ _id: req.params.id, isDeleted: false });
  if (!user) throw new AppError('User not found.', 404);
  if (user.role === 'admin') throw new AppError('Cannot delete an admin account.', 403);

  user.isDeleted = true;
  user.isActive = false;
  user.deletedAt = new Date();
  user.refreshTokenHash = undefined;
  await user.save();

  await audit(req, { action: 'delete', entity: 'User', entityId: user._id });

  res.json({ success: true, message: 'User deleted successfully.' });
});
