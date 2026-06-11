const Transaction  = require('../models/Transaction');
const Product      = require('../models/Product');
const Customer     = require('../models/Customer');
const StockMovement = require('../models/StockMovement');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const { audit }    = require('../utils/audit');
const { paginate } = require('../utils/paginate');
const mongoose     = require('mongoose');

// ─── Get all transactions ─────────────────────────────────────────────────
exports.getTransactions = asyncHandler(async (req, res) => {
  const {
    page, limit, search, status, paymentStatus,
    paymentMethod, customer, startDate, endDate,
    minAmount, maxAmount, hasBalance,
  } = req.query;

  const filter = { isDeleted: { $ne: true } };

  if (status)        filter.status        = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (paymentMethod) filter.paymentMethod = paymentMethod;
  if (customer)      filter.customer      = customer;

  // hasBalance=true filters only invoices with outstanding balance
  if (hasBalance === 'true') {
    filter.balance = { $gt: 0 };
  }

  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }

  if (minAmount || maxAmount) {
    filter.total = {};
    if (minAmount) filter.total.$gte = parseFloat(minAmount);
    if (maxAmount) filter.total.$lte = parseFloat(maxAmount);
  }

  if (search) {
    filter.$or = [
      { invoiceNumber: { $regex: search, $options: 'i' } },
      { customerName:  { $regex: search, $options: 'i' } },
    ];
  }

  const result = await paginate(
    Transaction,
    filter,
    { page, limit, sort: '-createdAt' },
    [
      { path: 'customer',   select: 'name customerCode phone' },
      { path: 'createdBy',  select: 'name' },
    ]
  );

  // Summary totals for current filter
  const summary = await Transaction.aggregate([
    { $match: { ...filter, status: { $ne: 'cancelled' } } },
    {
      $group: {
        _id:            null,
        totalRevenue:   { $sum: '$total' },
        totalPaid:      { $sum: '$amountPaid' },
        totalBalance:   { $sum: '$balance' },
        count:          { $sum: 1 },
      },
    },
  ]);

  res.json({
    success: true,
    ...result,
    summary: summary[0] || {
      totalRevenue: 0, totalPaid: 0, totalBalance: 0, count: 0,
    },
  });
});

// ─── Get single transaction ───────────────────────────────────────────────
exports.getById = asyncHandler(async (req, res) => {
  const transaction = await Transaction.findById(req.params.id)
    .populate('customer',  'name customerCode phone email address')
    .populate('createdBy', 'name email')
    .populate('items.product', 'name sku');

  if (!transaction) throw new AppError('Transaction not found.', 404);
  res.json({ success: true, data: transaction });
});

// ─── Create transaction ───────────────────────────────────────────────────
exports.createTransaction = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      customer, customerName, type, items,
      taxRate, paymentMethod, amountPaid, notes, dueDate,
    } = req.body;

    // Calculate totals
    let subtotal = 0;
    const processedItems = [];

    for (const item of items) {
      const product = await Product.findById(item.product).session(session);
      if (!product) throw new AppError(`Product ${item.product} not found.`, 404);
      if (product.availableStock < item.quantity) {
        throw new AppError(
          `Insufficient stock for "${product.name}". Available: ${product.availableStock}`,
          400
        );
      }

      const discount  = item.discount || 0;
      const itemTotal = item.quantity * item.unitPrice * (1 - discount / 100);
      subtotal       += itemTotal;

      processedItems.push({
        product:     product._id,
        productName: product.name,
        productSku:  product.sku,
        quantity:    item.quantity,
        unitPrice:   item.unitPrice,
        discount,
        subtotal:    itemTotal,
      });

      // Deduct stock
      await Product.findByIdAndUpdate(
        product._id,
        { $inc: { currentStock: -item.quantity } },
        { session }
      );

      // Log movement
      await StockMovement.create([{
        product:        product._id,
        type:           'sale',
        quantity:       -item.quantity,
        quantityBefore: product.currentStock,
        quantityAfter:  product.currentStock - item.quantity,
        performedBy:    req.user._id,
      }], { session });
    }

    const taxAmount = subtotal * ((taxRate || 0) / 100);
    const total     = subtotal + taxAmount;
    const paid      = Math.min(amountPaid || 0, total);
    const balance   = total - paid;

    const payStatus = balance <= 0
      ? 'paid'
      : paid > 0
        ? 'partial'
        : 'unpaid';

    const [transaction] = await Transaction.create([{
      customer:      customer || null,
      customerName:  customer ? undefined : (customerName || 'Walk-in'),
      type:          type || 'sale',
      status:        'confirmed',
      items:         processedItems,
      subtotal,
      taxRate:       taxRate || 0,
      taxAmount,
      total,
      amountPaid:    paid,
      balance,
      paymentMethod: paymentMethod || 'cash',
      paymentStatus: payStatus,
      notes,
      dueDate:       dueDate ? new Date(dueDate) : null,
      createdBy:     req.user._id,
    }], { session });

    // Update customer balance
    if (customer && balance > 0) {
      await Customer.findByIdAndUpdate(
        customer,
        { $inc: { currentBalance: balance } },
        { session }
      );
    }

    await session.commitTransaction();
    await audit(req, {
      action: 'create', entity: 'Transaction', entityId: transaction._id,
      meta: { total, paymentStatus: payStatus },
    });

    const populated = await Transaction.findById(transaction._id)
      .populate('customer', 'name customerCode')
      .populate('createdBy', 'name');

    res.status(201).json({
      success: true,
      message: 'Transaction created successfully.',
      data:    populated,
    });
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
});

// ─── Record a payment (partial or full) ──────────────────────────────────
exports.recordPayment = asyncHandler(async (req, res) => {
  const { amount, paymentMethod, notes } = req.body;

  if (!amount || amount <= 0) {
    throw new AppError('Payment amount must be greater than 0.', 400);
  }

  const transaction = await Transaction.findById(req.params.id);
  if (!transaction) throw new AppError('Transaction not found.', 404);
  if (transaction.status === 'cancelled') {
    throw new AppError('Cannot record payment on a cancelled transaction.', 400);
  }
  if (transaction.balance <= 0) {
    throw new AppError('This transaction is already fully paid.', 400);
  }

  const paymentAmount = Math.min(amount, transaction.balance);
  const prevBalance   = transaction.balance;
  const prevPaid      = transaction.amountPaid;

  transaction.amountPaid    += paymentAmount;
  transaction.balance        = Math.max(0, transaction.total - transaction.amountPaid);
  transaction.paymentMethod  = paymentMethod || transaction.paymentMethod;

  // Update payment status
  if (transaction.balance <= 0) {
    transaction.paymentStatus = 'paid';
    transaction.balance       = 0;
  } else {
    transaction.paymentStatus = 'partial';
  }

  // Append to payment history
  if (!transaction.paymentHistory) transaction.paymentHistory = [];
  transaction.paymentHistory.push({
    amount:        paymentAmount,
    paymentMethod: paymentMethod || transaction.paymentMethod,
    notes:         notes || null,
    recordedBy:    req.user._id,
    recordedAt:    new Date(),
    balanceBefore: prevBalance,
    balanceAfter:  transaction.balance,
  });

  await transaction.save();

  // Update customer outstanding balance
  if (transaction.customer) {
    await Customer.findByIdAndUpdate(
      transaction.customer,
      { $inc: { currentBalance: -paymentAmount } }
    );
  }

  await audit(req, {
    action:   'update',
    entity:   'Transaction',
    entityId: transaction._id,
    meta: {
      action:        'payment_recorded',
      amount:        paymentAmount,
      prevPaid,
      newPaid:       transaction.amountPaid,
      prevBalance,
      newBalance:    transaction.balance,
      paymentStatus: transaction.paymentStatus,
    },
  });

  const populated = await Transaction.findById(transaction._id)
    .populate('customer',  'name customerCode')
    .populate('createdBy', 'name');

  res.json({
    success: true,
    message: transaction.paymentStatus === 'paid'
      ? 'Payment recorded. Transaction is now fully paid!'
      : `Payment of ₦${paymentAmount.toLocaleString()} recorded. Remaining balance: ₦${transaction.balance.toLocaleString()}`,
    data: populated,
  });
});

// ─── Mark transaction as fully paid ──────────────────────────────────────
exports.markAsPaid = asyncHandler(async (req, res) => {
  const { paymentMethod, notes } = req.body;

  const transaction = await Transaction.findById(req.params.id);
  if (!transaction) throw new AppError('Transaction not found.', 404);
  if (transaction.status === 'cancelled') {
    throw new AppError('Cannot update a cancelled transaction.', 400);
  }
  if (transaction.balance <= 0) {
    throw new AppError('This transaction is already fully paid.', 400);
  }

  const prevBalance = transaction.balance;
  const prevPaid    = transaction.amountPaid;

  // Record the final payment for the full balance
  if (!transaction.paymentHistory) transaction.paymentHistory = [];
  transaction.paymentHistory.push({
    amount:        prevBalance,
    paymentMethod: paymentMethod || transaction.paymentMethod,
    notes:         notes || 'Marked as fully paid',
    recordedBy:    req.user._id,
    recordedAt:    new Date(),
    balanceBefore: prevBalance,
    balanceAfter:  0,
  });

  transaction.amountPaid    = transaction.total;
  transaction.balance       = 0;
  transaction.paymentStatus = 'paid';
  if (paymentMethod) transaction.paymentMethod = paymentMethod;

  await transaction.save();

  // Clear customer outstanding
  if (transaction.customer) {
    await Customer.findByIdAndUpdate(
      transaction.customer,
      { $inc: { currentBalance: -prevBalance } }
    );
  }

  await audit(req, {
    action: 'update', entity: 'Transaction', entityId: transaction._id,
    meta: {
      action: 'marked_paid', prevBalance, prevPaid,
      newPaid: transaction.amountPaid,
    },
  });

  const populated = await Transaction.findById(transaction._id)
    .populate('customer',  'name customerCode')
    .populate('createdBy', 'name');

  res.json({
    success: true,
    message: 'Transaction marked as fully paid!',
    data:    populated,
  });
});

// ─── Cancel transaction ───────────────────────────────────────────────────
exports.cancelTransaction = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const transaction = await Transaction.findById(req.params.id);
  if (!transaction) throw new AppError('Transaction not found.', 404);
  if (transaction.status === 'cancelled') {
    throw new AppError('Transaction is already cancelled.', 400);
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Restore stock
    for (const item of transaction.items) {
      await Product.findByIdAndUpdate(
        item.product,
        { $inc: { currentStock: item.quantity } },
        { session }
      );
    }

    // Restore customer balance
    if (transaction.customer && transaction.balance > 0) {
      await Customer.findByIdAndUpdate(
        transaction.customer,
        { $inc: { currentBalance: -transaction.balance } },
        { session }
      );
    }

    transaction.status = 'cancelled';
    transaction.notes  = transaction.notes
      ? `${transaction.notes} | Cancelled: ${reason}`
      : `Cancelled: ${reason}`;
    await transaction.save({ session });

    await session.commitTransaction();

    await audit(req, {
      action: 'update', entity: 'Transaction', entityId: transaction._id,
      meta: { action: 'cancelled', reason },
    });

    res.json({ success: true, message: 'Transaction cancelled.', data: transaction });
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
});