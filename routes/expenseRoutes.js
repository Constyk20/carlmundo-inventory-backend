const express = require('express');
const router = express.Router();
const {
  getExpenses, createExpense, getExpenseById, updateExpense,
  approveExpense, deleteExpense,
} = require('../controllers/expenseController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validate');
const { PERMISSIONS } = require('../config/constants');

router.use(protect);

router.get('/',              requirePermission(PERMISSIONS.EXPENSES_READ),    getExpenses);
router.get('/:id',           requirePermission(PERMISSIONS.EXPENSES_READ),    getExpenseById);
router.post('/',             requirePermission(PERMISSIONS.EXPENSES_WRITE),   validate(schemas.createExpense), createExpense);
router.put('/:id',           requirePermission(PERMISSIONS.EXPENSES_WRITE),   updateExpense);
router.put('/:id/approve',   requirePermission(PERMISSIONS.EXPENSES_APPROVE), validate(schemas.approveExpense), approveExpense);
router.delete('/:id',        requirePermission(PERMISSIONS.EXPENSES_DELETE),  deleteExpense);

module.exports = router;
