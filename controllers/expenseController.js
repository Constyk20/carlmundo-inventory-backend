const Expense = require('../models/Expense');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const { audit } = require('../utils/audit');
const { paginate } = require('../utils/paginate');

// ─── Get Expenses ──────────────────────────────────────────────────────────
exports.getExpenses = asyncHandler(async (req, res) => {
  const { page, limit, sort, search, category, status, startDate, endDate } = req.query;

  const filter = { isDeleted: false };
  if (category) filter.category = category;
  if (status) filter.status = status;
  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate) filter.date.$lte = new Date(endDate);
  }
  if (search) filter.$or = [
    { title: { $regex: search, $options: 'i' } },
    { vendor: { $regex: search, $options: 'i' } },
    { expenseCode: { $regex: search, $options: 'i' } },
  ];

  // Non-admin/manager only sees their own expenses
  const isManager = ['admin', 'manager', 'accountant'].includes(req.user.role);
  if (!isManager) filter.createdBy = req.user._id;

  const result = await paginate(Expense, filter, { page, limit, sort: sort || '-date' }, [
    { path: 'createdBy', select: 'name email' },
    { path: 'approvedBy', select: 'name email' },
  ]);

  // Total summary
  const summary = await Expense.aggregate([
    { $match: { ...filter, status: 'approved' } },
    {
      $group: {
        _id: '$category',
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
  ]);

  res.json({ success: true, ...result, summary });
});

// ─── Create Expense ────────────────────────────────────────────────────────
exports.createExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.create({
    ...req.body,
    createdBy: req.user._id,
    // Auto-approve if manager/admin creates it
    status: ['admin', 'manager', 'accountant'].includes(req.user.role) ? 'approved' : 'pending',
    approvedBy: ['admin', 'manager', 'accountant'].includes(req.user.role) ? req.user._id : undefined,
    approvedAt: ['admin', 'manager', 'accountant'].includes(req.user.role) ? new Date() : undefined,
  });

  await audit(req, { action: 'create', entity: 'Expense', entityId: expense._id });
  res.status(201).json({ success: true, message: 'Expense created.', data: expense });
});

// ─── Get Single Expense ────────────────────────────────────────────────────
exports.getExpenseById = asyncHandler(async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, isDeleted: false })
    .populate('createdBy', 'name email')
    .populate('approvedBy', 'name email');

  if (!expense) throw new AppError('Expense not found.', 404);
  res.json({ success: true, data: expense });
});

// ─── Update Expense ────────────────────────────────────────────────────────
exports.updateExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, isDeleted: false });
  if (!expense) throw new AppError('Expense not found.', 404);

  // Only creator or admin can edit, and only if pending
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && expense.createdBy.toString() !== req.user._id.toString()) {
    throw new AppError('You can only edit your own expenses.', 403);
  }
  if (!isAdmin && expense.status !== 'pending') {
    throw new AppError('Only pending expenses can be edited.', 400);
  }

  const allowed = ['title', 'description', 'category', 'amount', 'date', 'paymentMethod', 'vendor', 'receiptUrl', 'tags'];
  allowed.forEach((f) => { if (req.body[f] !== undefined) expense[f] = req.body[f]; });
  expense.updatedBy = req.user._id;
  if (!isAdmin) expense.status = 'pending'; // reset to pending on edit
  await expense.save();

  await audit(req, { action: 'update', entity: 'Expense', entityId: expense._id });
  res.json({ success: true, message: 'Expense updated.', data: expense });
});

// ─── Approve / Reject Expense ──────────────────────────────────────────────
exports.approveExpense = asyncHandler(async (req, res) => {
  const { action, rejectionReason } = req.body;
  const expense = await Expense.findOne({ _id: req.params.id, isDeleted: false });
  if (!expense) throw new AppError('Expense not found.', 404);
  if (expense.status !== 'pending') throw new AppError(`Expense is already ${expense.status}.`, 400);

  if (action === 'approve') {
    expense.status = 'approved';
    expense.approvedBy = req.user._id;
    expense.approvedAt = new Date();
  } else {
    expense.status = 'rejected';
    expense.rejectionReason = rejectionReason;
  }

  await expense.save();

  await audit(req, {
    action: action === 'approve' ? 'approve' : 'reject',
    entity: 'Expense',
    entityId: expense._id,
    meta: { action, rejectionReason },
  });

  res.json({ success: true, message: `Expense ${action}d.`, data: expense });
});

// ─── Delete Expense ────────────────────────────────────────────────────────
exports.deleteExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, isDeleted: false });
  if (!expense) throw new AppError('Expense not found.', 404);
  if (expense.status === 'approved' && req.user.role !== 'admin') {
    throw new AppError('Only admin can delete approved expenses.', 403);
  }

  expense.isDeleted = true;
  await expense.save();

  await audit(req, { action: 'delete', entity: 'Expense', entityId: expense._id });
  res.json({ success: true, message: 'Expense deleted.' });
});
