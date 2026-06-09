const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const { audit } = require('../utils/audit');
const { paginate } = require('../utils/paginate');

// ─── Get Products ──────────────────────────────────────────────────────────
exports.getProducts = asyncHandler(async (req, res) => {
  const { page, limit, sort, search, category, isActive, lowStock } = req.query;

  const filter = { isDeleted: false };
  if (category) filter.category = category;
  if (isActive !== undefined) filter.isActive = isActive === 'true';
  if (lowStock === 'true') filter.$expr = { $lte: ['$currentStock', '$lowStockThreshold'] };
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { sku: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }

  const result = await paginate(Product, filter, { page, limit, sort: sort || 'name' });

  // Summary stats
  const [totalStockValue, lowStockCount] = await Promise.all([
    Product.aggregate([
      { $match: { isDeleted: false, isActive: true } },
      { $group: { _id: null, total: { $sum: { $multiply: ['$currentStock', '$costPrice'] } } } },
    ]),
    Product.countDocuments({ isDeleted: false, $expr: { $lte: ['$currentStock', '$lowStockThreshold'] } }),
  ]);

  res.json({
    success: true,
    ...result,
    summary: {
      totalStockValue: totalStockValue[0]?.total || 0,
      lowStockCount,
    },
  });
});

// ─── Get Single Product ────────────────────────────────────────────────────
exports.getProductById = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, isDeleted: false })
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email');

  if (!product) throw new AppError('Product not found.', 404);
  res.json({ success: true, data: product });
});

// ─── Create Product ────────────────────────────────────────────────────────
exports.createProduct = asyncHandler(async (req, res) => {
  const skuExists = await Product.findOne({ sku: req.body.sku.toUpperCase() });
  if (skuExists) throw new AppError('A product with this SKU already exists.', 409);

  const product = await Product.create({
    ...req.body,
    createdBy: req.user._id,
  });

  // Log initial stock if provided
  if (product.currentStock > 0) {
    await StockMovement.create({
      product: product._id,
      type: 'purchase',
      quantity: product.currentStock,
      quantityBefore: 0,
      quantityAfter: product.currentStock,
      unitCost: product.costPrice,
      notes: 'Initial stock on product creation',
      performedBy: req.user._id,
    });
  }

  await audit(req, { action: 'create', entity: 'Product', entityId: product._id });
  res.status(201).json({ success: true, message: 'Product created.', data: product });
});

// ─── Update Product ────────────────────────────────────────────────────────
exports.updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, isDeleted: false });
  if (!product) throw new AppError('Product not found.', 404);

  const priceChanged =
    (req.body.costPrice !== undefined && req.body.costPrice !== product.costPrice) ||
    (req.body.sellingPrice !== undefined && req.body.sellingPrice !== product.sellingPrice);

  // Record price history if price changed
  if (priceChanged) {
    product.priceHistory.push({
      price: req.body.sellingPrice ?? product.sellingPrice,
      changedBy: req.user._id,
      reason: req.body.priceChangeReason || 'Manual update',
    });
  }

  const allowed = [
    'name', 'description', 'category', 'unit', 'lowStockThreshold',
    'maxStockLevel', 'costPrice', 'sellingPrice', 'dimensions', 'weight',
    'supplier', 'isActive',
  ];

  allowed.forEach((field) => {
    if (req.body[field] !== undefined) product[field] = req.body[field];
  });

  product.updatedBy = req.user._id;
  await product.save();

  await audit(req, { action: 'update', entity: 'Product', entityId: product._id });
  res.json({ success: true, message: 'Product updated.', data: product });
});

// ─── Adjust Stock ──────────────────────────────────────────────────────────
exports.adjustStock = asyncHandler(async (req, res) => {
  const { type, quantity, unitCost, reference, notes } = req.body;
  const product = await Product.findOne({ _id: req.params.id, isDeleted: false });
  if (!product) throw new AppError('Product not found.', 404);

  const inboundTypes = ['purchase', 'return', 'adjustment'];
  const outboundTypes = ['sale', 'damage', 'transfer', 'production_use'];

  const isInbound = inboundTypes.includes(type);
  const isOutbound = outboundTypes.includes(type);
  const absQty = Math.abs(quantity);

  if (isOutbound && product.currentStock < absQty) {
    throw new AppError(
      `Insufficient stock. Available: ${product.currentStock}, Requested: ${absQty}`,
      400
    );
  }

  const quantityBefore = product.currentStock;
  if (isInbound || (type === 'adjustment' && quantity > 0)) {
    product.currentStock += absQty;
  } else {
    product.currentStock -= absQty;
  }

  // For raw adjustment with negative qty
  if (type === 'adjustment' && quantity < 0) {
    if (product.currentStock < 0) throw new AppError('Stock cannot be negative.', 400);
  }

  product.updatedBy = req.user._id;
  await product.save();

  const movement = await StockMovement.create({
    product: product._id,
    type,
    quantity: isInbound ? absQty : -absQty,
    quantityBefore,
    quantityAfter: product.currentStock,
    unitCost: unitCost || product.costPrice,
    reference,
    notes,
    performedBy: req.user._id,
  });

  await audit(req, {
    action: 'update',
    entity: 'Product',
    entityId: product._id,
    meta: { stockAdjustment: { type, quantity, before: quantityBefore, after: product.currentStock } },
  });

  res.json({
    success: true,
    message: 'Stock adjusted successfully.',
    data: { product, movement },
  });
});

// ─── Get Stock Movements ───────────────────────────────────────────────────
exports.getStockMovements = asyncHandler(async (req, res) => {
  const { page, limit, type } = req.query;
  const filter = { product: req.params.id };
  if (type) filter.type = type;

  const result = await paginate(StockMovement, filter, { page, limit, sort: '-createdAt' }, {
    path: 'performedBy',
    select: 'name email',
  });

  res.json({ success: true, ...result });
});

// ─── Delete Product (soft) ─────────────────────────────────────────────────
exports.deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, isDeleted: false });
  if (!product) throw new AppError('Product not found.', 404);

  product.isDeleted = true;
  product.isActive = false;
  await product.save();

  await audit(req, { action: 'delete', entity: 'Product', entityId: product._id });
  res.json({ success: true, message: 'Product deleted.' });
});
