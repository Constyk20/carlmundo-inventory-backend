const express = require('express');
const router = express.Router();
const {
  getCustomers, getCustomerById, createCustomer, updateCustomer,
  deleteCustomer, getCustomerTransactions,
} = require('../controllers/customerController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validate');
const { PERMISSIONS } = require('../config/constants');

router.use(protect);

router.get('/',              requirePermission(PERMISSIONS.CUSTOMERS_READ),   getCustomers);
router.get('/:id',           requirePermission(PERMISSIONS.CUSTOMERS_READ),   getCustomerById);
router.get('/:id/transactions', requirePermission(PERMISSIONS.CUSTOMERS_READ), getCustomerTransactions);
router.post('/',             requirePermission(PERMISSIONS.CUSTOMERS_WRITE),  validate(schemas.createCustomer), createCustomer);
router.put('/:id',           requirePermission(PERMISSIONS.CUSTOMERS_WRITE),  updateCustomer);
router.delete('/:id',        requirePermission(PERMISSIONS.CUSTOMERS_DELETE), deleteCustomer);

module.exports = router;
