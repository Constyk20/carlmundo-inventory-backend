const express = require('express');
const router  = express.Router();
const {
  getMaterials,
  getMaterialsByCategory,
  getMaterialById,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  markAsFinished,
  unmarkFinished,
  bulkMarkFinished,
  bulkDelete,
  adjustMaterial,
  getMaterialMovements,
  getProductionSummary,
} = require('../controllers/productionController');
const { protect }           = require('../middleware/auth');
const { authorize }         = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validate');
const { ROLES }             = require('../config/constants');

router.use(protect);

const canView  = [ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION_MANAGER, ROLES.STAFF];
const canWrite = [ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION_MANAGER];
const canDelete = [ROLES.ADMIN, ROLES.MANAGER];

router.get('/summary',     authorize(canView),  getProductionSummary);
router.get('/by-category', authorize(canView),  getMaterialsByCategory);
router.get('/',            authorize(canView),  getMaterials);
router.get('/:id',         authorize(canView),  getMaterialById);

router.post('/',           authorize(canWrite), validate(schemas.createMaterial), createMaterial);
router.put('/:id',         authorize(canWrite), updateMaterial);
router.delete('/:id',      authorize(canDelete), deleteMaterial);

// Single finish / unfinish
router.put('/:id/finish',   authorize(canWrite), markAsFinished);
router.put('/:id/unfinish', authorize(canWrite), unmarkFinished);

// Adjust stock
router.post('/:id/adjust',    authorize(canWrite), validate(schemas.adjustMaterial), adjustMaterial);
router.get('/:id/movements',  authorize(canWrite), getMaterialMovements);

// Bulk operations
router.post('/bulk/finish', authorize(canWrite),  bulkMarkFinished);
router.post('/bulk/delete', authorize(canDelete), bulkDelete);

module.exports = router;