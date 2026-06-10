const RawMaterial      = require('../models/RawMaterial');
const MaterialMovement = require('../models/MaterialMovement');
const asyncHandler     = require('../utils/asyncHandler');
const { AppError }     = require('../middleware/errorHandler');
const { audit }        = require('../utils/audit');
const { paginate }     = require('../utils/paginate');
const { MATERIAL_CATEGORIES } = require('../models/RawMaterial');

// ─── Get all materials ────────────────────────────────────────────────────
exports.getMaterials = asyncHandler(async (req, res) => {
  const { page, limit, search, category, lowStock, isActive, isFinished } = req.query;

  const filter = { isDeleted: false };
  if (category)   filter.category   = category;
  if (isActive   !== undefined) filter.isActive   = isActive   === 'true';
  if (isFinished !== undefined) filter.isFinished = isFinished === 'true';
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

  const categorySummary = await RawMaterial.aggregate([
    { $match: { isDeleted: false, isActive: true } },
    {
      $group: {
        _id:            '$category',
        totalMaterials: { $sum: 1 },
        finishedCount:  { $sum: { $cond: ['$isFinished', 1, 0] } },
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
    grouped[cat] = await RawMaterial.find({
      category:  cat,
      isDeleted: false,
      isActive:  true,
    }).sort('isFinished name');
  }
  res.json({ success: true, data: grouped });
});

// ─── Get single material ──────────────────────────────────────────────────
exports.getMaterialById = asyncHandler(async (req, res) => {
  const material = await RawMaterial.findOne({
    _id: req.params.id, isDeleted: false,
  })
    .populate('createdBy',  'name email')
    .populate('finishedBy', 'name email');

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

  const qty = currentQuantity || 0;

  const material = await RawMaterial.create({
    name, code, category, description, unit,
    currentQuantity:   qty,
    lowStockThreshold: lowStockThreshold || 10,
    unitCost:          unitCost          || 0,
    supplier,
    // Auto-finish if created with 0 stock
    isFinished: qty === 0,
    createdBy:  req.user._id,
  });

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

  if (
    req.body.unitCost !== undefined &&
    req.body.unitCost !== material.unitCost
  ) {
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

// ─── Delete single material (soft) ───────────────────────────────────────
exports.deleteMaterial = asyncHandler(async (req, res) => {
  const material = await RawMaterial.findOne({
    _id: req.params.id, isDeleted: false,
  });
  if (!material) throw new AppError('Material not found.', 404);

  material.isDeleted = true;
  material.isActive  = false;
  material.deletedAt = new Date();
  await material.save();

  await audit(req, {
    action: 'delete', entity: 'RawMaterial', entityId: material._id,
  });
  res.json({ success: true, message: 'Material deleted.' });
});

// ─── Mark single material as finished ────────────────────────────────────
exports.markAsFinished = asyncHandler(async (req, res) => {
  const { note } = req.body;
  const material = await RawMaterial.findOne({
    _id: req.params.id, isDeleted: false,
  });
  if (!material) throw new AppError('Material not found.', 404);
  if (material.isFinished) {
    throw new AppError('Material is already marked as finished.', 400);
  }

  material.isFinished   = true;
  material.finishedAt   = new Date();
  material.finishedBy   = req.user._id;
  material.finishedNote = note || null;
  material.updatedBy    = req.user._id;
  await material.save();

  await audit(req, {
    action:   'update',
    entity:   'RawMaterial',
    entityId: material._id,
    meta:     { action: 'mark_finished', note },
  });

  res.json({
    success: true,
    message: `"${material.name}" marked as finished.`,
    data:    material,
  });
});

// ─── Unmark finished ──────────────────────────────────────────────────────
exports.unmarkFinished = asyncHandler(async (req, res) => {
  const material = await RawMaterial.findOne({
    _id: req.params.id, isDeleted: false,
  });
  if (!material) throw new AppError('Material not found.', 404);

  material.isFinished   = false;
  material.finishedAt   = undefined;
  material.finishedBy   = undefined;
  material.finishedNote = undefined;
  material.updatedBy    = req.user._id;
  await material.save();

  await audit(req, {
    action:   'update',
    entity:   'RawMaterial',
    entityId: material._id,
    meta:     { action: 'unmark_finished' },
  });

  res.json({
    success: true,
    message: `"${material.name}" is now active.`,
    data:    material,
  });
});

// ─── BULK: Mark multiple as finished ─────────────────────────────────────
exports.bulkMarkFinished = asyncHandler(async (req, res) => {
  const { ids, note } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError('No material IDs provided.', 400);
  }

  const result = await RawMaterial.updateMany(
    { _id: { $in: ids }, isDeleted: false, isFinished: false },
    {
      $set: {
        isFinished:   true,
        finishedAt:   new Date(),
        finishedBy:   req.user._id,
        finishedNote: note || null,
        updatedBy:    req.user._id,
        updatedAt:    new Date(),
      },
    }
  );

  await audit(req, {
    action: 'update',
    entity: 'RawMaterial',
    meta:   { action: 'bulk_mark_finished', ids, count: result.modifiedCount },
  });

  res.json({
    success: true,
    message: `${result.modifiedCount} material(s) marked as finished.`,
    data:    { modifiedCount: result.modifiedCount },
  });
});

// ─── BULK: Delete multiple ────────────────────────────────────────────────
exports.bulkDelete = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError('No material IDs provided.', 400);
  }

  const result = await RawMaterial.updateMany(
    { _id: { $in: ids }, isDeleted: false },
    {
      $set: {
        isDeleted: true,
        isActive:  false,
        deletedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );

  await audit(req, {
    action: 'delete',
    entity: 'RawMaterial',
    meta:   { action: 'bulk_delete', ids, count: result.modifiedCount },
  });

  res.json({
    success: true,
    message: `${result.modifiedCount} material(s) deleted.`,
    data:    { deletedCount: result.modifiedCount },
  });
});

// ─── Adjust quantity ──────────────────────────────────────────────────────
// KEY RULES:
//  1. Any inbound movement (purchase / return / adjustment+) on a
//     finished material automatically unmarks it as finished.
//  2. When the resulting stock hits 0, the material is automatically
//     marked as finished.
exports.adjustMaterial = asyncHandler(async (req, res) => {
  const {
    type, quantity, unitCost, reference,
    notes, relatedProduct, batchQuantity,
  } = req.body;

  const material = await RawMaterial.findOne({
    _id: req.params.id, isDeleted: false,
  });
  if (!material) throw new AppError('Material not found.', 404);

  const outbound = ['used_in_production', 'damage'];
  const inbound  = ['purchase', 'return'];
  const absQty   = Math.abs(quantity);

  // ── Rule 1: Restocking a finished material → auto-unfinish ────────────
  const isRestocking = inbound.includes(type) ||
    (type === 'adjustment' && quantity > 0);

  if (material.isFinished && isRestocking) {
    material.isFinished   = false;
    material.finishedAt   = undefined;
    material.finishedBy   = undefined;
    material.finishedNote = undefined;
  }

  // ── Validate outbound stock ───────────────────────────────────────────
  if (outbound.includes(type) && material.currentQuantity < absQty) {
    throw new AppError(
      `Insufficient stock. Available: ${material.currentQuantity}, Requested: ${absQty}`,
      400
    );
  }

  const before = material.currentQuantity;

  if (outbound.includes(type)) {
    material.currentQuantity -= absQty;
  } else {
    material.currentQuantity += absQty;
  }

  // ── Rule 2: Stock hits 0 → auto-finish ───────────────────────────────
  if (material.currentQuantity === 0 && !material.isFinished) {
    material.isFinished   = true;
    material.finishedAt   = new Date();
    material.finishedBy   = req.user._id;
    material.finishedNote = `Auto-finished: stock reached 0 via ${type}`;
  }

  material.updatedBy = req.user._id;
  await material.save();

  const movement = await MaterialMovement.create({
    material:       material._id,
    type,
    quantity:       outbound.includes(type) ? -absQty : absQty,
    quantityBefore: before,
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
      quantity:   outbound.includes(type) ? -absQty : absQty,
      before,
      after:      material.currentQuantity,
      autoAction: material.currentQuantity === 0
        ? 'auto_finished'
        : isRestocking && before === 0
          ? 'auto_unfinished'
          : null,
    },
  });

  // Build a meaningful response message
  let message = 'Stock updated.';
  if (material.currentQuantity === 0) {
    message = `Stock reached 0 — "${material.name}" has been automatically marked as finished.`;
  } else if (isRestocking && !material.isFinished && before === 0) {
    message = `"${material.name}" restocked and automatically marked as active.`;
  } else if (isRestocking && !material.isFinished) {
    message = `"${material.name}" restocked and unmarked as finished.`;
  }

  res.json({
    success: true,
    message,
    data: {
      material,
      movement,
      autoFinished:   material.currentQuantity === 0,
      autoUnfinished: isRestocking && !material.isFinished,
    },
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
      { path: 'performedBy',    select: 'name email' },
      { path: 'relatedProduct', select: 'name sku' },
    ]
  );

  res.json({ success: true, ...result });
});

// ─── Production summary ───────────────────────────────────────────────────
exports.getProductionSummary = asyncHandler(async (req, res) => {
  const [
    totalMaterials,
    lowStockMaterials,
    finishedMaterials,
    totalValue,
    recentUsage,
    categoryBreakdown,
  ] = await Promise.all([
    RawMaterial.countDocuments({ isDeleted: false, isActive: true }),

    RawMaterial.countDocuments({
      isDeleted: false, isActive: true,
      $expr: { $lte: ['$currentQuantity', '$lowStockThreshold'] },
    }),

    RawMaterial.countDocuments({ isDeleted: false, isFinished: true }),

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
      .sort('-createdAt').limit(10)
      .populate('material',       'name code category')
      .populate('relatedProduct', 'name sku')
      .populate('performedBy',    'name'),

    RawMaterial.aggregate([
      { $match: { isDeleted: false, isActive: true } },
      {
        $group: {
          _id:           '$category',
          count:         { $sum: 1 },
          finishedCount: { $sum: { $cond: ['$isFinished', 1, 0] } },
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
      finishedMaterials,
      totalInventoryValue: totalValue[0]?.total || 0,
      recentUsage,
      categoryBreakdown,
    },
  });
});