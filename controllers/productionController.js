const RawMaterial     = require('../models/RawMaterial');
const MaterialMovement = require('../models/MaterialMovement');
const asyncHandler    = require('../utils/asyncHandler');
const { AppError }    = require('../middleware/errorHandler');
const { audit }       = require('../utils/audit');
const { paginate }    = require('../utils/paginate');
const { MATERIAL_CATEGORIES } = require('../models/RawMaterial');

// ─── Get all materials ────────────────────────────────────────────────────
exports.getMaterials = asyncHandler(async (req, res) => {
  const { page, limit, search, category, lowStock, isActive } = req.query;

  const filter = { isDeleted: false };
  if (category) filter.category = category;
  if (isActive !== undefined) filter.isActive = isActive === 'true';
  if (lowStock === 'true') {
    filter.$expr = { $lte: ['$currentQuantity', '$lowStockThreshold'] };
  }
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { code: { $regex: search, $options: 'i' } },
    ];
  }

  const result = await paginate(
    RawMaterial,
    filter,
    { page, limit, sort: 'category name' },
    { path: 'createdBy', select: 'name' }
  );

  // Summary per category
  const categorySummary = await RawMaterial.aggregate([
    { $match: { isDeleted: false, isActive: true } },
    {
      $group: {
        _id:          '$category',
        totalMaterials: { $sum: 1 },
        lowStockCount: {
          $sum: {
            $cond: [{ $lte: ['$currentQuantity', '$lowStockThreshold'] }, 1, 0],
          },
        },
        totalValue: {
          $sum: { $multiply: ['$currentQuantity', '$unitCost'] },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.json({ success: true, ...result, categorySummary });
});

// ─── Get materials grouped by category ───────────────────────────────────
exports.getMaterialsByCategory = asyncHandler(async (req, res) => {
  const grouped = {};

  for (const cat of MATERIAL_CATEGORIES) {
    const materials = await RawMaterial.find({
      category:  cat,
      isDeleted: false,
      isActive:  true,
    }).sort('name');
    grouped[cat] = materials;
  }

  res.json({ success: true, data: grouped });
});

// ─── Get single material ──────────────────────────────────────────────────
exports.getMaterialById = asyncHandler(async (req, res) => {
  const material = await RawMaterial.findOne({
    _id:       req.params.id,
    isDeleted: false,
  }).populate('createdBy', 'name email');

  if (!material) throw new AppError('Material not found.', 404);
  res.json({ success: true, data: material });
});

// ─── Create material ──────────────────────────────────────────────────────
exports.createMaterial = asyncHandler(async (req, res) => {
  const {
    name, code, category, description, unit,
    currentQuantity, lowStockThreshold, unitCost, supplier,
  } = req.body;

  if (code) {
    const exists = await RawMaterial.findOne({ code: code.toUpperCase() });
    if (exists) throw new AppError('A material with this code already exists.', 409);
  }

  const material = await RawMaterial.create({
    name, code, category, description, unit,
    currentQuantity: currentQuantity || 0,
    lowStockThreshold: lowStockThreshold || 10,
    unitCost: unitCost || 0,
    supplier,
    createdBy: req.user._id,
  });

  // Log opening stock movement if quantity > 0
  if (material.currentQuantity > 0) {
    await MaterialMovement.create({
      material:       material._id,
      type:           'purchase',
      quantity:       material.currentQuantity,
      quantityBefore: 0,
      quantityAfter:  material.currentQuantity,
      unitCost:       material.unitCost,
      notes:          'Opening stock on material creation',
      performedBy:    req.user._id,
    });
  }

  await audit(req, {
    action: 'create', entity: 'RawMaterial', entityId: material._id,
  });

  res.status(201).json({
    success: true,
    message: 'Raw material created.',
    data:    material,
  });
});

// ─── Update material ──────────────────────────────────────────────────────
exports.updateMaterial = asyncHandler(async (req, res) => {
  const material = await RawMaterial.findOne({
    _id: req.params.id, isDeleted: false,
  });
  if (!material) throw new AppError('Material not found.', 404);

  const allowed = [
    'name', 'description', 'unit', 'lowStockThreshold',
    'unitCost', 'supplier', 'isActive', 'category',
  ];

  // Track price change
  if (req.body.unitCost !== undefined &&
      req.body.unitCost !== material.unitCost) {
    material.priceHistory.push({
      price:     req.body.unitCost,
      changedBy: req.user._id,
      reason:    req.body.priceChangeReason || 'Manual update',
    });
  }

  allowed.forEach((f) => {
    if (req.body[f] !== undefined) material[f] = req.body[f];
  });
  material.updatedBy = req.user._id;
  await material.save();

  await audit(req, {
    action: 'update', entity: 'RawMaterial', entityId: material._id,
  });

  res.json({ success: true, message: 'Material updated.', data: material });
});

// ─── Delete material (soft) ───────────────────────────────────────────────
exports.deleteMaterial = asyncHandler(async (req, res) => {
  const material = await RawMaterial.findOne({
    _id: req.params.id, isDeleted: false,
  });
  if (!material) throw new AppError('Material not found.', 404);

  material.isDeleted = true;
  material.isActive  = false;
  await material.save();

  await audit(req, {
    action: 'delete', entity: 'RawMaterial', entityId: material._id,
  });
  res.json({ success: true, message: 'Material deleted.' });
});

// ─── Adjust quantity (restock / damage / use) ────────────────────────────
exports.adjustMaterial = asyncHandler(async (req, res) => {
  const { type, quantity, unitCost, reference, notes, relatedProduct, batchQuantity } = req.body;

  const material = await RawMaterial.findOne({
    _id: req.params.id, isDeleted: false,
  });
  if (!material) throw new AppError('Material not found.', 404);

  const outboundTypes = ['used_in_production', 'damage'];
  const absQty        = Math.abs(quantity);

  if (outboundTypes.includes(type) && material.currentQuantity < absQty) {
    throw new AppError(
      `Insufficient stock. Available: ${material.currentQuantity}, Requested: ${absQty}`,
      400
    );
  }

  const quantityBefore = material.currentQuantity;

  if (outboundTypes.includes(type)) {
    material.currentQuantity -= absQty;
  } else {
    material.currentQuantity += absQty;
  }

  material.updatedBy = req.user._id;
  await material.save();

  const movement = await MaterialMovement.create({
    material:       material._id,
    type,
    quantity:       outboundTypes.includes(type) ? -absQty : absQty,
    quantityBefore,
    quantityAfter:  material.currentQuantity,
    unitCost:       unitCost || material.unitCost,
    reference,
    notes,
    relatedProduct,
    batchQuantity,
    performedBy:    req.user._id,
  });

  await audit(req, {
    action:   'update',
    entity:   'RawMaterial',
    entityId: material._id,
    meta: {
      type,
      quantity:  outboundTypes.includes(type) ? -absQty : absQty,
      before:    quantityBefore,
      after:     material.currentQuantity,
    },
  });

  res.json({
    success: true,
    message: 'Material quantity updated.',
    data:    { material, movement },
  });
});

// ─── Get movements for a material ────────────────────────────────────────
exports.getMaterialMovements = asyncHandler(async (req, res) => {
  const { page, limit, type } = req.query;
  const filter = { material: req.params.id };
  if (type) filter.type = type;

  const result = await paginate(
    MaterialMovement,
    filter,
    { page, limit, sort: '-createdAt' },
    [
      { path: 'performedBy',   select: 'name email' },
      { path: 'relatedProduct', select: 'name sku' },
    ]
  );

  res.json({ success: true, ...result });
});

// ─── Production summary dashboard ────────────────────────────────────────
exports.getProductionSummary = asyncHandler(async (req, res) => {
  const [
    totalMaterials,
    lowStockMaterials,
    totalValue,
    recentUsage,
    categoryBreakdown,
  ] = await Promise.all([
    RawMaterial.countDocuments({ isDeleted: false, isActive: true }),

    RawMaterial.countDocuments({
      isDeleted: false,
      isActive:  true,
      $expr: { $lte: ['$currentQuantity', '$lowStockThreshold'] },
    }),

    RawMaterial.aggregate([
      { $match: { isDeleted: false, isActive: true } },
      {
        $group: {
          _id:   null,
          total: { $sum: { $multiply: ['$currentQuantity', '$unitCost'] } },
        },
      },
    ]),

    MaterialMovement.find({ type: 'used_in_production' })
      .sort('-createdAt')
      .limit(10)
      .populate('material',       'name code category')
      .populate('relatedProduct', 'name sku')
      .populate('performedBy',    'name'),

    RawMaterial.aggregate([
      { $match: { isDeleted: false, isActive: true } },
      {
        $group: {
          _id:           '$category',
          count:         { $sum: 1 },
          totalQty:      { $sum: '$currentQuantity' },
          totalValue:    { $sum: { $multiply: ['$currentQuantity', '$unitCost'] } },
          lowStockCount: {
            $sum: {
              $cond: [
                { $lte: ['$currentQuantity', '$lowStockThreshold'] }, 1, 0,
              ],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  res.json({
    success: true,
    data: {
      totalMaterials,
      lowStockMaterials,
      totalInventoryValue: totalValue[0]?.total || 0,
      recentUsage,
      categoryBreakdown,
    },
  });
});