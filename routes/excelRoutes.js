const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
  exportProducts, importProducts, exportTransactions,
  exportExpenses, exportCustomers, getImportTemplate, importCustomers,
} = require('../controllers/excelController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/constants');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Only .xlsx / .xls files are accepted.'));
  },
});

router.use(protect);

router.get('/template',            requirePermission(PERMISSIONS.EXCEL_EXPORT), getImportTemplate);
router.get('/export/products',     requirePermission(PERMISSIONS.EXCEL_EXPORT), exportProducts);
router.get('/export/transactions', requirePermission(PERMISSIONS.EXCEL_EXPORT), exportTransactions);
router.get('/export/expenses',     requirePermission(PERMISSIONS.EXCEL_EXPORT), exportExpenses);
router.get('/export/customers',    requirePermission(PERMISSIONS.EXCEL_EXPORT), exportCustomers);
router.post('/import/products',   requirePermission(PERMISSIONS.EXCEL_IMPORT), upload.single('file'), importProducts);
router.post('/import/customers',  requirePermission(PERMISSIONS.EXCEL_IMPORT), upload.single('file'), importCustomers);

module.exports = router;
