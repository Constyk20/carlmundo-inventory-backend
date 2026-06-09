const AuditLog = require('../models/AuditLog');
const logger = require('../config/logger');

/**
 * Creates an audit log entry. Non-blocking — errors are caught and logged.
 */
const audit = async (req, { action, entity, entityId, changes, meta, status = 'success' }) => {
  try {
    await AuditLog.create({
      user: req.user?._id,
      userEmail: req.user?.email,
      action,
      entity,
      entityId,
      changes,
      ipAddress: req.ip || req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent'],
      meta,
      status,
    });
  } catch (err) {
    logger.error('Failed to write audit log:', err);
  }
};

/**
 * Compute a simple before/after diff for update operations.
 */
const diff = (before, after) => {
  const changes = {};
  const beforeObj = before?.toObject ? before.toObject() : before;
  const afterObj = after?.toObject ? after.toObject() : after;

  const excludeFields = ['password', 'refreshTokenHash', '__v', 'updatedAt'];

  for (const key of Object.keys(afterObj)) {
    if (excludeFields.includes(key)) continue;
    const bVal = JSON.stringify(beforeObj[key]);
    const aVal = JSON.stringify(afterObj[key]);
    if (bVal !== aVal) {
      changes[key] = { before: beforeObj[key], after: afterObj[key] };
    }
  }
  return changes;
};

module.exports = { audit, diff };
