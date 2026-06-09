const express = require('express');
const router  = express.Router();
const {
  getPriceLists, getPriceListById, createPriceList,
  updatePriceList, deletePriceList, assignCustomers, lookupPrice,
} = require('../controllers/priceController');
const { protect }           = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS }       = require('../config/constants');

router.use(protect);

// Price lookup (all users with PRICES_READ)
router.get('/lookup', requirePermission(PERMISSIONS.PRICES_READ), lookupPrice);

// CRUD (PRICES_READ / PRICES_WRITE)
router.get('/',    requirePermission(PERMISSIONS.PRICES_READ),  getPriceLists);
router.get('/:id', requirePermission(PERMISSIONS.PRICES_READ),  getPriceListById);

router.post('/',               requirePermission(PERMISSIONS.PRICES_WRITE), createPriceList);
router.put('/:id',             requirePermission(PERMISSIONS.PRICES_WRITE), updatePriceList);
router.put('/:id/customers',   requirePermission(PERMISSIONS.PRICES_WRITE), assignCustomers);
router.delete('/:id',          requirePermission(PERMISSIONS.PRICES_WRITE), deletePriceList);

module.exports = router;
