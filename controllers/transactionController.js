const Transaction = require('../models/Transaction');
const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');
const Customer = require('../models/Customer');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const { audit } = require('../utils/audit');
const { paginate } = require('../utils/paginate');
const mongoose = require('mongoose');

// ─── Create Transaction ────────────────────────────────────────────────────
exports.createTransaction = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { customer, customerName, type, items, taxRate, paymentMethod, amountPaid, notes, dueDate, deliveryDate } = req.body;

    // Verify all products exist and have stock (for sales)
    const productIds = items.map((i) => i.product);
    const products = await Product.find({ _id: { $in: productIds }, isDeleted: false }).session(session);

    const productMap = {};
    products.forEach((p) => { productMap[p._id.toString()] = p; });

    // Validate and enrich items
    const enrichedItems = [];
    let subtotal = 0;

    for (const item of items) {
      const product = productMap[item.product];
      if (!product) throw new AppError(`Product ${item.product} not found.`, 404);
      if (!product.isActive) throw new AppError(`Product '${product.name}' is inactive.`, 400);

      if (type === 'sale' && product.currentStock < item.quantity) {
        throw new AppError(
          `Insufficient stock for '${product.name}'. Available: ${product.currentStock}, Requested: ${item.quantity}`,
          400
        );
      }

      const discountMultiplier = 1 - (item.discount || 0) / 100;
      const itemSubtotal = item.quantity * item.unitPrice * discountMultiplier;
      subtotal += itemSubtotal;

      enrichedItems.push({
        product: product._id,
        productName: product.name,
        productSku: product.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount || 0,
        subtotal: parseFloat(itemSubtotal.toFixed(2)),
      });
    }

    const taxAmount = parseFloat((subtotal * ((taxRate || 0) / 100)).toFixed(2));
    const total = parseFloat((subtotal + taxAmount).toFixed(2));
    const paid = amountPaid ?? total;
    const balance = parseFloat((total - paid).toFixed(2));
    const paymentStatus = balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';

    // Create transaction
    const [transaction] = await Transaction.create(
      [
        {
          customer: customer || undefined,
          customerName: customerName,
          type,
          items: enrichedItems,
          subtotal: parseFloat(subtotal.toFixed(2)),
          taxRate: taxRate || 0,
          taxAmount,
          total,
          amountPaid: paid,
          balance,
          paymentMethod,
          paymentStatus,
          notes,
          dueDate,
          deliveryDate,
          createdBy: req.user._id,
        },
      ],
      { session }
    );

    // Deduct stock for sales
    if (type === 'sale') {
      for (const item of enrichedItems) {
        const product = productMap[item.product.toString()];
        const quantityBefore = product.currentStock;
        await Product.findByIdAndUpdate(
          item.product,
          { $inc: { currentStock: -item.quantity }, updatedBy: req.user._id },
          { session }
        );

        await StockMovement.create(
          [
            {
              product: item.product,
              type: 'sale',
              quantity: -item.quantity,
              quantityBefore,
              quantityAfter: quantityBefore - item.quantity,
              unitCost: item.unitPrice,
              reference: transaction.invoiceNumber,
              relatedTransaction: transaction._id,
              performedBy: req.user._id,
            },
          ],
          { session }
        );
      }

      // Update customer balance
      if (customer && balance > 0) {
        await Customer.findByIdAndUpdate(
          customer,
          { $inc: { currentBalance: balance } },
          { session }
        );
      }
    }

    await session.commitTransaction();

    await audit(req, {
      action: 'create',
      entity: 'Transaction',
      entityId: transaction._id,
      meta: { invoiceNumber: transaction.invoiceNumber, total },
    });

    const populated = await Transaction.findById(transaction._id)
      .populate('customer', 'name email customerCode')
      .populate('createdBy', 'name email');

    res.status(201).json({ success: true, message: 'Transaction created.', data: populated });
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
});

// ─── Get Transactions ──────────────────────────────────────────────────────
exports.getTransactions = asyncHandler(async (req, res) => {
  const { page, limit, sort, search, status, paymentStatus, customer, startDate, endDate, type } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (customer) filter.customer = customer;
  if (type) filter.type = type;
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }
  if (search) {
    filter.$or = [
      { invoiceNumber: { $regex: search, $options: 'i' } },
      { customerName: { $regex: search, $options: 'i' } },
    ];
  }

  const result = await paginate(
    Transaction,
    filter,
    { page, limit, sort: sort || '-createdAt' },
    [
      { path: 'customer', select: 'name email customerCode' },
      { path: 'createdBy', select: 'name email' },
    ]
  );

  res.json({ success: true, ...result });
});

// ─── Get Single Transaction ────────────────────────────────────────────────
exports.getTransactionById = asyncHandler(async (req, res) => {
  const transaction = await Transaction.findById(req.params.id)
    .populate('customer', 'name email phone address')
    .populate('createdBy', 'name email')
    .populate('items.product', 'name sku');

  if (!transaction) throw new AppError('Transaction not found.', 404);
  res.json({ success: true, data: transaction });
});

// ─── Cancel Transaction ────────────────────────────────────────────────────
exports.cancelTransaction = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) throw new AppError('Cancellation reason is required.', 400);

  const transaction = await Transaction.findById(req.params.id);
  if (!transaction) throw new AppError('Transaction not found.', 404);
  if (['cancelled', 'refunded'].includes(transaction.status)) {
    throw new AppError('Transaction is already cancelled or refunded.', 400);
  }

  // Restore stock
  for (const item of transaction.items) {
    await Product.findByIdAndUpdate(item.product, { $inc: { currentStock: item.quantity } });
    await StockMovement.create({
      product: item.product,
      type: 'return',
      quantity: item.quantity,
      quantityBefore: 0, // will be resolved in reporting
      quantityAfter: 0,
      reference: transaction.invoiceNumber,
      notes: `Cancellation: ${reason}`,
      performedBy: req.user._id,
    });
  }

  transaction.status = 'cancelled';
  transaction.cancelledBy = req.user._id;
  transaction.cancelReason = reason;
  await transaction.save();

  await audit(req, {
    action: 'update',
    entity: 'Transaction',
    entityId: transaction._id,
    meta: { action: 'cancel', reason },
  });

  res.json({ success: true, message: 'Transaction cancelled and stock restored.' });
});
