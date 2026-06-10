const express = require('express');
const router  = express.Router();
const {
  getMaterials,
  getMaterialsByCategory,
  getMaterialById,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  adjustMaterial,
  getMaterialMovements,
  getProductionSummary,
} = require('../controllers/productionController');
const { protect }           = require('../middleware/auth');
const { authorize }         = require('../middleware/rbac');
const { ROLES }             = require('../config/constants');
const { validate, schemas } = require('../middleware/validate');

router.use(protect);

// Summary dashboard
router.get('/summary', authorize([
  ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION_MANAGER,
]), getProductionSummary);

// Grouped by category
router.get('/by-category', authorize([
  ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION_MANAGER, ROLES.STAFF,
]), getMaterialsByCategory);

// CRUD
router.get('/', authorize([
  ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION_MANAGER, ROLES.STAFF,
]), getMaterials);

router.get('/:id', authorize([
  ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION_MANAGER, ROLES.STAFF,
]), getMaterialById);

router.post('/', authorize([
  ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION_MANAGER,
]), validate(schemas.createMaterial), createMaterial);

router.put('/:id', authorize([
  ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION_MANAGER,
]), updateMaterial);

router.delete('/:id', authorize([
  ROLES.ADMIN, ROLES.MANAGER,
]), deleteMaterial);

// Stock adjustments
router.post('/:id/adjust', authorize([
  ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION_MANAGER,
]), validate(schemas.adjustMaterial), adjustMaterial);

// Movement history
router.get('/:id/movements', authorize([
  ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION_MANAGER,
]), getMaterialMovements);

module.exports = router;