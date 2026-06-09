const Notification = require('../models/Notification');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const { paginate } = require('../utils/paginate');

// ─── Get notifications for the current user ────────────────────────────────
exports.getNotifications = asyncHandler(async (req, res) => {
  const { page, limit, unreadOnly } = req.query;
  const userId  = req.user._id;
  const userRole = req.user.role;

  // Build a filter that finds notifications targeting this user/role or broadcasts
  const recipientFilter = {
    $or: [
      { recipients: userId },
      { recipientRoles: userRole },
      { recipients: { $size: 0 }, recipientRoles: { $size: 0 } },
    ],
  };

  // Not-expired filter
  const expiryFilter = {
    $or: [
      { expiresAt: { $gt: new Date() } },
      { expiresAt: { $exists: false } },
    ],
  };

  const filter = { $and: [recipientFilter, expiryFilter] };

  if (unreadOnly === 'true') {
    filter['readBy.user'] = { $ne: userId };
  }

  const result = await paginate(Notification, filter, {
    page,
    limit,
    sort: '-createdAt',
  });

  const unreadCount = await Notification.countDocuments({
    ...filter,
    'readBy.user': { $ne: userId },
  });

  res.json({ success: true, ...result, unreadCount });
});

// ─── Mark one notification as read ────────────────────────────────────────
exports.markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findById(req.params.id);
  if (!notification) throw new AppError('Notification not found.', 404);

  const alreadyRead = notification.readBy.some(
    (r) => r.user.toString() === req.user._id.toString()
  );

  if (!alreadyRead) {
    notification.readBy.push({ user: req.user._id });
    await notification.save();
  }

  res.json({ success: true, message: 'Marked as read.' });
});

// ─── Mark all notifications as read ───────────────────────────────────────
exports.markAllAsRead = asyncHandler(async (req, res) => {
  const userId   = req.user._id;
  const userRole = req.user.role;

  const notifications = await Notification.find({
    $or: [{ recipients: userId }, { recipientRoles: userRole }],
    'readBy.user': { $ne: userId },
  });

  await Promise.all(
    notifications.map((n) => {
      n.readBy.push({ user: userId });
      return n.save();
    })
  );

  res.json({
    success: true,
    message: `${notifications.length} notification(s) marked as read.`,
  });
});

// ─── Create a notification (admin/system) ─────────────────────────────────
exports.createNotification = asyncHandler(async (req, res) => {
  const { title, message, type, recipients, recipientRoles, link } = req.body;

  const notification = await Notification.create({
    title,
    message,
    type: type || 'info',
    recipients: recipients || [],
    recipientRoles: recipientRoles || [],
    link,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });

  res.status(201).json({ success: true, message: 'Notification sent.', data: notification });
});

// ─── Delete a notification (admin only) ───────────────────────────────────
exports.deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findByIdAndDelete(req.params.id);
  if (!notification) throw new AppError('Notification not found.', 404);
  res.json({ success: true, message: 'Notification deleted.' });
});
