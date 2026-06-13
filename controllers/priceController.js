const PriceList = require('../models/PriceList');
const Product   = require('../models/Product');
const Customer  = require('../models/Customer');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const { audit }    = require('../utils/audit');
const { paginate } = require('../utils/paginate');

// ─── List price lists ──────────────────────────────────────────────────────
exports.getPriceLists = asyncHandler(async (req, res) => {
  const { page, limit, isActive, type } = req.query;
  const filter = {};
  if (isActive !== undefined) filter.isActive = isActive === 'true';
  if (type) filter.type = type;

  const result = await paginate(PriceList, filter, { page, limit, sort: 'name' }, [
    { path: 'assignedCustomers', select: 'name customerCode' },
    { path: 'createdBy',         select: 'name email' },
  ]);
  res.json({ success: true, ...result });
});

// ─── Get single price list ─────────────────────────────────────────────────
exports.getPriceListById = asyncHandler(async (req, res) => {
  const pl = await PriceList.findById(req.params.id)
    .populate('entries.product', 'name sku sellingPrice costPrice')
    .populate('assignedCustomers', 'name customerCode email')
    .populate('createdBy', 'name email');
  if (!pl) throw new AppError('Price list not found.', 404);
  
  // Format response with product details
  const formattedEntries = pl.entries.map(entry => ({
    product: entry.product,
    productName: entry.productName || entry.product?.name,
    productSku: entry.productSku || entry.product?.sku,
    costPrice: entry.product?.costPrice || 0,
    standardPrice: entry.product?.sellingPrice || 0,
    tiers: entry.tiers || [],
  }));
  
  const response = {
    ...pl.toObject(),
    entries: formattedEntries,
  };
  
  res.json({ success: true, data: response });
});

// ─── Create price list ─────────────────────────────────────────────────────
exports.createPriceList = asyncHandler(async (req, res) => {
  const { name, description, type, currency, globalDiscount, entries, assignedCustomers, validFrom, validUntil } = req.body;

  // Enrich entries with product names and calculate tiered pricing
  const enrichedEntries = [];
  for (const entry of (entries || [])) {
    const product = await Product.findById(entry.product).select('name sku sellingPrice costPrice');
    if (!product) throw new AppError(`Product ${entry.product} not found.`, 404);
    
    const tiers = entry.tiers || calculateDefaultTiers(product.costPrice, product.sellingPrice);
    
    enrichedEntries.push({
      ...entry,
      productName: product.name,
      productSku:  product.sku,
      costPrice: product.costPrice,
      standardPrice: product.sellingPrice,
      tiers: tiers,
    });
  }

  const pl = await PriceList.create({
    name, description, type, currency, globalDiscount,
    entries: enrichedEntries,
    assignedCustomers: assignedCustomers || [],
    validFrom, validUntil,
    createdBy: req.user._id,
  });

  await audit(req, { action: 'create', entity: 'PriceList', entityId: pl._id });
  res.status(201).json({ success: true, message: 'Price list created.', data: pl });
});

// ─── Update price list ─────────────────────────────────────────────────────
exports.updatePriceList = asyncHandler(async (req, res) => {
  const pl = await PriceList.findById(req.params.id);
  if (!pl) throw new AppError('Price list not found.', 404);

  const allowed = ['name', 'description', 'type', 'currency', 'globalDiscount',
                   'assignedCustomers', 'validFrom', 'validUntil', 'isActive'];
  allowed.forEach((f) => { if (req.body[f] !== undefined) pl[f] = req.body[f]; });

  // If entries are provided, re-enrich them with tiered pricing
  if (req.body.entries) {
    const enriched = [];
    for (const entry of req.body.entries) {
      const product = await Product.findById(entry.product).select('name sku sellingPrice costPrice');
      if (!product) throw new AppError(`Product ${entry.product} not found.`, 404);
      
      const tiers = entry.tiers || calculateDefaultTiers(product.costPrice, product.sellingPrice);
      
      enriched.push({ 
        ...entry, 
        productName: product.name, 
        productSku: product.sku,
        costPrice: product.costPrice,
        standardPrice: product.sellingPrice,
        tiers: tiers,
      });
    }
    pl.entries = enriched;
  }

  pl.updatedBy = req.user._id;
  await pl.save();

  await audit(req, { action: 'update', entity: 'PriceList', entityId: pl._id });
  res.json({ success: true, message: 'Price list updated.', data: pl });
});

// ─── Delete price list ─────────────────────────────────────────────────────
exports.deletePriceList = asyncHandler(async (req, res) => {
  const pl = await PriceList.findByIdAndDelete(req.params.id);
  if (!pl) throw new AppError('Price list not found.', 404);
  await audit(req, { action: 'delete', entity: 'PriceList', entityId: pl._id });
  res.json({ success: true, message: 'Price list deleted.' });
});

// ─── Assign price list to customers ───────────────────────────────────────
exports.assignCustomers = asyncHandler(async (req, res) => {
  const { customerIds } = req.body;
  if (!Array.isArray(customerIds)) throw new AppError('customerIds must be an array.', 400);

  const customers = await Customer.find({ _id: { $in: customerIds } }).select('_id');
  if (customers.length !== customerIds.length) {
    throw new AppError('One or more customer IDs are invalid.', 400);
  }

  const pl = await PriceList.findByIdAndUpdate(
    req.params.id,
    { $addToSet: { assignedCustomers: { $each: customerIds } }, updatedBy: req.user._id },
    { new: true }
  ).populate('assignedCustomers', 'name customerCode');

  if (!pl) throw new AppError('Price list not found.', 404);
  res.json({ success: true, message: 'Customers assigned.', data: pl });
});

// ─── Look up effective price for a product + customer ─────────────────────
exports.lookupPrice = asyncHandler(async (req, res) => {
  const { productId, customerId, quantity = 1 } = req.query;
  if (!productId) throw new AppError('productId is required.', 400);

  const product = await Product.findById(productId).select('name sku sellingPrice costPrice');
  if (!product) throw new AppError('Product not found.', 404);

  let effectivePrice = product.sellingPrice;
  let priceListName  = 'Standard';
  let discountApplied = 0;
  let appliedTier = null;

  if (customerId) {
    const now = new Date();
    const pl = await PriceList.findOne({
      assignedCustomers: customerId,
      isActive: true,
      $or: [{ validFrom: { $lte: now } }, { validFrom: { $exists: false } }],
      $or: [{ validUntil: { $gte: now } }, { validUntil: { $exists: false } }],
      'entries.product': productId,
    }).sort('-createdAt');

    if (pl) {
      const entry = pl.entries.find(
        (e) => e.product.toString() === productId
      );
      
      if (entry && entry.tiers && entry.tiers.length > 0) {
        // Find the best tier for the quantity
        const qty = Number(quantity);
        const applicableTiers = entry.tiers
          .filter(tier => qty >= tier.minQuantity)
          .sort((a, b) => b.minQuantity - a.minQuantity);
        
        if (applicableTiers.length > 0) {
          appliedTier = applicableTiers[0];
          effectivePrice = appliedTier.price;
          priceListName = pl.name;
        }
      }
      
      // Apply global discount if no tier applied
      if (!appliedTier && pl.globalDiscount > 0) {
        discountApplied = pl.globalDiscount;
        effectivePrice = effectivePrice * (1 - discountApplied / 100);
        priceListName = pl.name;
      }
    }
  }

  const profit = effectivePrice - product.costPrice;
  const profitMargin = product.costPrice > 0 ? ((profit / product.costPrice) * 100) : 0;

  res.json({
    success: true,
    data: {
      product: { 
        id: product._id, 
        name: product.name, 
        sku: product.sku,
        costPrice: product.costPrice 
      },
      standardPrice: product.sellingPrice,
      effectivePrice: parseFloat(effectivePrice.toFixed(2)),
      priceList: priceListName,
      discountApplied,
      quantity: Number(quantity),
      lineTotal: parseFloat((effectivePrice * Number(quantity)).toFixed(2)),
      appliedTier: appliedTier ? {
        minQuantity: appliedTier.minQuantity,
        price: appliedTier.price,
        profitMargin: parseFloat(profitMargin.toFixed(1)),
      } : null,
    },
  });
});

// Helper function to calculate default tiered pricing based on cost
function calculateDefaultTiers(costPrice, standardPrice) {
  const tiers = [];
  
  // Common quantity breakpoints
  const breakpoints = [
    { qty: 1, margin: 0 },      // Standard price
    { qty: 10, margin: 0.30 },  // 30% margin
    { qty: 20, margin: 0.25 },  // 25% margin
    { qty: 50, margin: 0.20 },  // 20% margin
    { qty: 100, margin: 0.15 }, // 15% margin
  ];

  for (const bp of breakpoints) {
    const price = bp.qty === 1 
      ? standardPrice 
      : costPrice * (1 + bp.margin);
    const profitMargin = ((price - costPrice) / costPrice * 100);
    
    tiers.push({
      minQuantity: bp.qty,
      price: parseFloat(price.toFixed(2)),
      profitMargin: parseFloat(profitMargin.toFixed(1)),
    });
  }

  return tiers;
}