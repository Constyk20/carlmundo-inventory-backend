const Customer = require('../models/Customer');
const Transaction = require('../models/Transaction');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const { audit } = require('../utils/audit');
const { paginate } = require('../utils/paginate');

exports.getCustomers = asyncHandler(async (req, res) => {
  const { page, limit, sort, search, type, isActive } = req.query;
  const filter = { isDeleted: false };
  if (type) filter.type = type;
  if (isActive !== undefined) filter.isActive = isActive === 'true';
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { customerCode: { $regex: search, $options: 'i' } },
    ];
  }

  const result = await paginate(Customer, filter, { page, limit, sort: sort || 'name' });
  res.json({ success: true, ...result });
});

exports.getCustomerById = asyncHandler(async (req, res) => {
  const customer = await Customer.findOne({ _id: req.params.id, isDeleted: false });
  if (!customer) throw new AppError('Customer not found.', 404);

  // Get purchase history summary
  const purchaseSummary = await Transaction.aggregate([
    { $match: { customer: customer._id, type: 'sale', status: { $ne: 'cancelled' } } },
    {
      $group: {
        _id: null,
        totalPurchases: { $sum: 1 },
        totalSpent: { $sum: '$total' },
        totalPaid: { $sum: '$amountPaid' },
        lastPurchase: { $max: '$createdAt' },
      },
    },
  ]);

  res.json({ success: true, data: { ...customer.toObject(), purchaseSummary: purchaseSummary[0] || null } });
});

exports.createCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.create({ ...req.body, createdBy: req.user._id });
  await audit(req, { action: 'create', entity: 'Customer', entityId: customer._id });
  res.status(201).json({ success: true, message: 'Customer created.', data: customer });
});

exports.updateCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { ...req.body, updatedBy: req.user._id },
    { new: true, runValidators: true }
  );
  if (!customer) throw new AppError('Customer not found.', 404);
  await audit(req, { action: 'update', entity: 'Customer', entityId: customer._id });
  res.json({ success: true, message: 'Customer updated.', data: customer });
});

exports.deleteCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findOne({ _id: req.params.id, isDeleted: false });
  if (!customer) throw new AppError('Customer not found.', 404);

  const hasTransactions = await Transaction.exists({ customer: customer._id });
  if (hasTransactions) {
    // Soft delete only — preserve transaction history
    customer.isDeleted = true;
    customer.isActive = false;
    await customer.save();
  } else {
    await customer.deleteOne();
  }

  await audit(req, { action: 'delete', entity: 'Customer', entityId: customer._id });
  res.json({ success: true, message: 'Customer deleted.' });
});

exports.getCustomerTransactions = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const customer = await Customer.findOne({ _id: req.params.id, isDeleted: false });
  if (!customer) throw new AppError('Customer not found.', 404);

  const result = await paginate(
    Transaction,
    { customer: customer._id },
    { page, limit, sort: '-createdAt' }
  );

  res.json({ success: true, ...result });
});
