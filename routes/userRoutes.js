const express = require('express');
const router = express.Router();
const {
  getUsers, getUserById, updateUser, deactivateUser, activateUser,
  resetUserPassword, updateFeatureRestrictions, getAuditLogs, deleteUser,
} = require('../controllers/userController');
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validate');

// All user management routes require admin
router.use(protect, adminOnly);

router.get('/', getUsers);
router.get('/audit-logs', getAuditLogs);
router.get('/:id', getUserById);
router.put('/:id', validate(schemas.updateUser), updateUser);
router.put('/:id/deactivate', deactivateUser);
router.put('/:id/activate', activateUser);
router.put('/:id/reset-password', resetUserPassword);
router.put('/:id/feature-restrictions', updateFeatureRestrictions);
router.delete('/:id', deleteUser);

module.exports = router;
