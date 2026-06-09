const RegistrationRequest = require('../models/RegistrationRequest');
const User = require('../models/User');
const Notification = require('../models/Notification');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const { audit } = require('../utils/audit');
const { paginate } = require('../utils/paginate');
const { ROLES, ROLE_DEFAULT_PERMISSIONS } = require('../config/constants');

// ─── Public: Submit a registration request ────────────────────────────────
// Anyone can hit this — no auth required
exports.submitRequest = asyncHandler(async (req, res) => {
  const { name, email, phone, requestedRole, reason } = req.body;

  // Check if email already has an account
  const userExists = await User.findOne({ email });
  if (userExists) {
    throw new AppError('An account with this email already exists.', 409);
  }

  // Check if there's already a pending request for this email
  const existingRequest = await RegistrationRequest.findOne({ email, status: 'pending' });
  if (existingRequest) {
    throw new AppError('A registration request for this email is already pending review.', 409);
  }

  const request = await RegistrationRequest.create({
    name,
    email,
    phone,
    requestedRole: requestedRole || ROLES.STAFF,
    reason,
  });

  // Notify all admins and managers
  const admins = await User.find({
    role: { $in: [ROLES.ADMIN, ROLES.MANAGER] },
    isActive: true,
  }).select('_id');

  if (admins.length > 0) {
    await Notification.create({
      title: 'New Registration Request',
      message: `${name} (${email}) has requested access to the system as ${requestedRole || 'staff'}.`,
      type: 'info',
      recipients: admins.map((a) => a._id),
      link: '/admin/registration-requests',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
  }

  res.status(201).json({
    success: true,
    message: 'Registration request submitted successfully. You will be notified once reviewed.',
    data: {
      id: request._id,
      name: request.name,
      email: request.email,
      status: request.status,
    },
  });
});

// ─── Admin: Get all registration requests ─────────────────────────────────
exports.getRequests = asyncHandler(async (req, res) => {
  const { page, limit, status, search } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (search) {
    filter.$or = [
      { name:  { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const result = await paginate(
    RegistrationRequest,
    filter,
    { page, limit, sort: '-createdAt' },
    { path: 'reviewedBy', select: 'name email' }
  );

  // Pending count for badge
  const pendingCount = await RegistrationRequest.countDocuments({ status: 'pending' });

  res.json({ success: true, ...result, pendingCount });
});

// ─── Admin: Get single request ─────────────────────────────────────────────
exports.getRequestById = asyncHandler(async (req, res) => {
  const request = await RegistrationRequest.findById(req.params.id)
    .populate('reviewedBy', 'name email')
    .populate('createdUser', 'name email role');

  if (!request) throw new AppError('Registration request not found.', 404);
  res.json({ success: true, data: request });
});

// ─── Admin: Approve a request ──────────────────────────────────────────────
exports.approveRequest = asyncHandler(async (req, res) => {
  const { role, permissions } = req.body;

  const request = await RegistrationRequest.findById(req.params.id);
  if (!request) throw new AppError('Registration request not found.', 404);
  if (request.status !== 'pending') {
    throw new AppError(`This request has already been ${request.status}.`, 400);
  }

  // Check email not already taken (race condition guard)
  const userExists = await User.findOne({ email: request.email });
  if (userExists) {
    throw new AppError('An account with this email already exists.', 409);
  }

  // Determine final role and permissions
  const finalRole = role || request.requestedRole;
  const finalPermissions = permissions || ROLE_DEFAULT_PERMISSIONS[finalRole] || [];

  // Generate a temporary password — user must change on first login
  const tempPassword = generateTempPassword();

  // Create the user account
  const user = await User.create({
    name:        request.name,
    email:       request.email,
    password:    tempPassword,
    role:        finalRole,
    permissions: finalPermissions,
    isActive:    true,
    createdBy:   req.user._id,
  });

  // Update the request
  request.status      = 'approved';
  request.reviewedBy  = req.user._id;
  request.reviewedAt  = new Date();
  request.createdUser = user._id;
  await request.save();

  await audit(req, {
    action: 'approve',
    entity: 'RegistrationRequest',
    entityId: request._id,
    meta: { email: request.email, role: finalRole },
  });

  res.json({
    success: true,
    message: `Request approved. Account created for ${request.email}.`,
    data: {
      user: {
        id:       user._id,
        name:     user.name,
        email:    user.email,
        role:     user.role,
      },
      // In production, send this via email to the user
      // For now it's returned in the response for the admin to share
      temporaryPassword: tempPassword,
      note: 'Share this temporary password with the user. They should change it on first login.',
    },
  });
});

// ─── Admin: Reject a request ───────────────────────────────────────────────
exports.rejectRequest = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) throw new AppError('Rejection reason is required.', 400);

  const request = await RegistrationRequest.findById(req.params.id);
  if (!request) throw new AppError('Registration request not found.', 404);
  if (request.status !== 'pending') {
    throw new AppError(`This request has already been ${request.status}.`, 400);
  }

  request.status          = 'rejected';
  request.reviewedBy      = req.user._id;
  request.reviewedAt      = new Date();
  request.rejectionReason = reason;
  await request.save();

  await audit(req, {
    action: 'reject',
    entity: 'RegistrationRequest',
    entityId: request._id,
    meta: { email: request.email, reason },
  });

  res.json({
    success: true,
    message: `Registration request from ${request.email} has been rejected.`,
  });
});

// ─── Admin: Delete a request ───────────────────────────────────────────────
exports.deleteRequest = asyncHandler(async (req, res) => {
  const request = await RegistrationRequest.findByIdAndDelete(req.params.id);
  if (!request) throw new AppError('Registration request not found.', 404);
  res.json({ success: true, message: 'Request deleted.' });
});

// ─── Helper: generate a readable temporary password ───────────────────────
const generateTempPassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const specials = '@$!%*?&';
  let password = '';
  // Ensure at least one uppercase, lowercase, digit, special
  password += 'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.floor(Math.random() * 22)];
  password += 'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random() * 22)];
  password += '23456789'[Math.floor(Math.random() * 8)];
  password += specials[Math.floor(Math.random() * specials.length)];
  for (let i = 0; i < 6; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
};