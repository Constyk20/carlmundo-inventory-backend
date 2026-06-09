const express = require('express');
const router = express.Router();
const {
  getProducts, getProductById, createProduct, updateProduct,
  adjustStock, getStockMovements, deleteProduct,
} = require('../controllers/productController');
const { protect } = require('../middleware/auth');
const { authorize, requirePermission } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validate');
const { PERMISSIONS } = require('../config/constants');

router.use(protect);

router.get('/', requirePermission(PERMISSIONS.INVENTORY_READ), getProducts);
router.get('/:id', requirePermission(PERMISSIONS.INVENTORY_READ), getProductById);
router.get('/:id/movements', requirePermission(PERMISSIONS.INVENTORY_READ), getStockMovements);

router.post(
  '/',
  requirePermission(PERMISSIONS.INVENTORY_WRITE),
  validate(schemas.createProduct),
  createProduct
);

router.put(
  '/:id',
  requirePermission(PERMISSIONS.INVENTORY_WRITE),
  validate(schemas.updateProduct),
  updateProduct
);

router.post(
  '/:id/adjust-stock',
  requirePermission(PERMISSIONS.INVENTORY_WRITE),
  validate(schemas.adjustStock),
  adjustStock
);

router.delete('/:id', requirePermission(PERMISSIONS.INVENTORY_DELETE), deleteProduct);

module.exports = router;
