const { ROLES } = require('../config/constants');

/**
 * Authorize by role and/or permission.
 * Admin always passes.
 * @param {string[]} roles - allowed roles
 * @param {string[]} permissions - required permissions (any match = pass)
 * @param {string} [feature] - optional feature flag to check restrictions
 */
const authorize = (roles = [], permissions = [], feature = null) => {
  return (req, res, next) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ success: false, message: 'Not authenticated.' });
    }

    // Admin always has full access
    if (user.role === ROLES.ADMIN) {
      // But still check feature restrictions for admin if explicitly set
      // (admins can restrict themselves from sensitive ops — optional design)
      return next();
    }

    // Check account active status (double-check — auth.js already does this)
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account deactivated.' });
    }

    // Role check
    if (roles.length > 0 && !roles.includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}.`,
      });
    }

    // Permission check (any match)
    if (permissions.length > 0) {
      const userPermissions = user.permissions || [];
      const hasPermission = permissions.some((p) => userPermissions.includes(p));
      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to perform this action.',
        });
      }
    }

    // Feature restriction check
    if (feature && user.restrictedFeatures?.includes(feature)) {
      return res.status(403).json({
        success: false,
        message: `Access to '${feature}' has been restricted for your account.`,
      });
    }

    next();
  };
};

/**
 * Require a specific permission (shorthand).
 */
const requirePermission = (...perms) => authorize([], perms);

/**
 * Require admin role.
 */
const adminOnly = authorize([ROLES.ADMIN]);

module.exports = { authorize, requirePermission, adminOnly };
