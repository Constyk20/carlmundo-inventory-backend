const express = require('express');
const router  = express.Router();
const {
  submitRequest, getRequests, getRequestById,
  approveRequest, rejectRequest, deleteRequest,
} = require('../controllers/registrationController');
const { protect } = require('../middleware/auth');
const { adminOnly, authorize } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validate');
const { ROLES } = require('../config/constants');

// ── Public (no auth) ───────────────────────────────────────────────────────
// Anyone can submit a request to join
router.post('/submit', validate(schemas.submitRegistrationRequest), submitRequest);

// ── Protected: Admin + Manager can review requests ────────────────────────
router.use(protect);

router.get(
  '/',
  authorize([ROLES.ADMIN, ROLES.MANAGER]),
  getRequests
);

router.get(
  '/:id',
  authorize([ROLES.ADMIN, ROLES.MANAGER]),
  getRequestById
);

// Only admin can approve, reject, or delete
router.put('/:id/approve', adminOnly, validate(schemas.approveRegistrationRequest), approveRequest);
router.put('/:id/reject',  adminOnly, validate(schemas.rejectRegistrationRequest),  rejectRequest);
router.delete('/:id',      adminOnly, deleteRequest);

module.exports = router;