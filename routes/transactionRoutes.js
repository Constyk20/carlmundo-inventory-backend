const express = require('express');
const router = express.Router();
const {
  createTransaction, getTransactions, getTransactionById, cancelTransaction,
} = require('../controllers/transactionController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validate');
const { PERMISSIONS } = require('../config/constants');

router.use(protect);

router.get('/',          requirePermission(PERMISSIONS.TRANSACTIONS_READ),   getTransactions);
router.get('/:id',       requirePermission(PERMISSIONS.TRANSACTIONS_READ),   getTransactionById);
router.post('/',         requirePermission(PERMISSIONS.TRANSACTIONS_WRITE),  validate(schemas.createTransaction), createTransaction);
router.put('/:id/cancel', requirePermission(PERMISSIONS.TRANSACTIONS_DELETE), cancelTransaction);

module.exports = router;
