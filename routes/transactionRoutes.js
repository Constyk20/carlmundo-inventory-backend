const express = require('express');
const router  = express.Router();
const {
  getTransactions,
  getById,
  createTransaction,
  recordPayment,
  markAsPaid,
  cancelTransaction,
} = require('../controllers/transactionController');
const { protect }           = require('../middleware/auth');
const { authorize }         = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validate');
const { ROLES }             = require('../config/constants');

router.use(protect);

const canView  = [ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTANT, ROLES.STAFF];
const canWrite = [ROLES.ADMIN, ROLES.MANAGER, ROLES.STAFF];
const canDelete = [ROLES.ADMIN, ROLES.MANAGER];

router.get('/',    authorize(canView),  getTransactions);
router.get('/:id', authorize(canView),  getById);

router.post('/',   authorize(canWrite), createTransaction);

// Payment routes
router.post('/:id/payment',  authorize(canWrite), recordPayment);
router.put('/:id/mark-paid', authorize(canWrite), markAsPaid);

// Cancel
router.put('/:id/cancel', authorize(canDelete), cancelTransaction);

module.exports = router;