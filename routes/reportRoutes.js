const express = require('express');
const router = express.Router();
const {
  getDashboard, getSalesReport, getExpenseReport,
  getInventoryReport, getProfitLoss,
} = require('../controllers/reportController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/constants');

router.use(protect);

router.get('/dashboard',    requirePermission(PERMISSIONS.REPORTS_READ), getDashboard);
router.get('/sales',        requirePermission(PERMISSIONS.REPORTS_READ), getSalesReport);
router.get('/expenses',     requirePermission(PERMISSIONS.REPORTS_READ), getExpenseReport);
router.get('/inventory',    requirePermission(PERMISSIONS.REPORTS_READ), getInventoryReport);
router.get('/profit-loss',  requirePermission(PERMISSIONS.REPORTS_READ), getProfitLoss);

module.exports = router;
