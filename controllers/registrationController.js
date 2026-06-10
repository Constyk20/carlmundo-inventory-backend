const RegistrationRequest = require('../models/RegistrationRequest');
const User                = require('../models/User');
const Notification        = require('../models/Notification');
const asyncHandler        = require('../utils/asyncHandler');
const { AppError }        = require('../middleware/errorHandler');
const { audit }           = require('../utils/audit');
const { paginate }        = require('../utils/paginate');
const { ROLES, ROLE_DEFAULT_PERMISSIONS } = require('../config/constants');

// ─── Public: Submit a registration request ────────────────────────────────
exports.submitRequest = asyncHandler(async (req, res) => {
  const { name, email, password, phone, requestedRole, reason } = req.body;

  const userExists = await User.findOne({ email });
  if (userExists) {
    throw new AppError('An account with this email already exists.', 409);
  }

  const existingRequest = await RegistrationRequest.findOne({
    email,
    status: 'pending',
  });
  if (existingRequest) {
    throw new AppError(
      'A registration request for this email is already pending review.',
      409
    );
  }

  // password is hashed by the RegistrationRequest pre-save hook
  const request = await RegistrationRequest.create({
    name,
    email,
    password,
    phone,
    requestedRole: requestedRole || ROLES.SUPERVISOR,
    reason,
  });

  const admins = await User.find({
    role:     { $in: [ROLES.ADMIN, ROLES.MANAGER] },
    isActive: true,
  }).select('_id');

  if (admins.length > 0) {
    await Notification.create({
      title:   'New Registration Request',
      message: `${name} (${email}) has requested access as ${requestedRole || 'supervisor'}.`,
      type:    'info',
      recipients: admins.map((a) => a._id),
      link:    '/admin/registration-requests',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
  }

  res.status(201).json({
    success: true,
    message: 'Registration request submitted. You will be notified once reviewed.',
    data: {
      id:     request._id,
      name:   request.name,
      email:  request.email,
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

  const pendingCount = await RegistrationRequest.countDocuments({ status: 'pending' });

  res.json({ success: true, ...result, pendingCount });
});

// ─── Admin: Get single request ─────────────────────────────────────────────
exports.getRequestById = asyncHandler(async (req, res) => {
  const request = await RegistrationRequest.findById(req.params.id)
    .populate('reviewedBy',  'name email')
    .populate('createdUser', 'name email role');

  if (!request) throw new AppError('Registration request not found.', 404);
  res.json({ success: true, data: request });
});

// ─── Admin: Approve a request ──────────────────────────────────────────────
exports.approveRequest = asyncHandler(async (req, res) => {
  const { role, permissions } = req.body;

  // Must select +password since it has select: false on the model
  const request = await RegistrationRequest.findById(req.params.id).select('+password');
  if (!request) throw new AppError('Registration request not found.', 404);
  if (request.status !== 'pending') {
    throw new AppError(`This request has already been ${request.status}.`, 400);
  }

  // Race-condition guard
  const userExists = await User.findOne({ email: request.email });
  if (userExists) {
    throw new AppError('An account with this email already exists.', 409);
  }

  const finalRole        = role || request.requestedRole;
  const finalPermissions = permissions || ROLE_DEFAULT_PERMISSIONS[finalRole] || [];

  // Use collection.insertOne to bypass the User pre-save bcrypt hook
  // so the already-hashed password is not double-hashed
  await User.collection.insertOne({
    name:               request.name,
    email:              request.email,
    password:           request.password, // already bcrypt-hashed
    role:               finalRole,
    permissions:        finalPermissions,
    restrictedFeatures: [],
    isActive:           true,
    isDeleted:          false,
    loginAttempts:      0,
    createdBy:          req.user._id,
    createdAt:          new Date(),
    updatedAt:          new Date(),
  });

  // Get the created user document
  const createdUser = await User.findOne({ email: request.email });

  // Update the request: set approved fields and remove the stored password
  await RegistrationRequest.collection.updateOne(
    { _id: request._id },
    {
      $set: {
        status:      'approved',
        reviewedBy:  req.user._id,
        reviewedAt:  new Date(),
        createdUser: createdUser._id,
      },
      $unset: { password: '' }, // delete hashed password — no longer needed
    }
  );

  await audit(req, {
    action:   'approve',
    entity:   'RegistrationRequest',
    entityId: request._id,
    meta:     { email: request.email, role: finalRole },
  });

  // No temporaryPassword in response — user uses the password they set
  res.json({
    success: true,
    message: `Request approved. Account created for ${request.email}.`,
    data: {
      user: {
        id:    createdUser._id,
        name:  createdUser.name,
        email: createdUser.email,
        role:  createdUser.role,
      },
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
    action:   'reject',
    entity:   'RegistrationRequest',
    entityId: request._id,
    meta:     { email: request.email, reason },
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