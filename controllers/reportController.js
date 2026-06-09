const Transaction = require('../models/Transaction');
const Expense = require('../models/Expense');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const StockMovement = require('../models/StockMovement');
const asyncHandler = require('../utils/asyncHandler');

const getDateRange = (period) => {
  const now = new Date();
  const start = new Date();
  switch (period) {
    case 'today': start.setHours(0, 0, 0, 0); break;
    case 'week': start.setDate(now.getDate() - 7); break;
    case 'month': start.setMonth(now.getMonth() - 1); break;
    case 'quarter': start.setMonth(now.getMonth() - 3); break;
    case 'year': start.setFullYear(now.getFullYear() - 1); break;
    default: start.setMonth(now.getMonth() - 1);
  }
  return { start, end: now };
};

// ─── Dashboard Summary ─────────────────────────────────────────────────────
exports.getDashboard = asyncHandler(async (req, res) => {
  const { period = 'month' } = req.query;
  const { start, end } = getDateRange(period);
  const dateFilter = { $gte: start, $lte: end };

  const [
    salesData, expenseData, productStats, customerStats,
    lowStockItems, recentSales, topProducts,
  ] = await Promise.all([
    // Sales summary
    Transaction.aggregate([
      { $match: { createdAt: dateFilter, type: 'sale', status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$total' },
          totalPaid: { $sum: '$amountPaid' },
          totalBalance: { $sum: '$balance' },
          count: { $sum: 1 },
        },
      },
    ]),

    // Expense summary
    Expense.aggregate([
      { $match: { date: dateFilter, status: 'approved', isDeleted: false } },
      { $group: { _id: null, totalExpenses: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),

    // Product stats
    Product.aggregate([
      { $match: { isDeleted: false, isActive: true } },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          totalStockValue: { $sum: { $multiply: ['$currentStock', '$costPrice'] } },
          lowStockCount: {
            $sum: { $cond: [{ $lte: ['$currentStock', '$lowStockThreshold'] }, 1, 0] },
          },
          outOfStockCount: {
            $sum: { $cond: [{ $eq: ['$currentStock', 0] }, 1, 0] },
          },
        },
      },
    ]),

    // Customer stats
    Customer.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          totalOutstanding: { $sum: '$currentBalance' },
        },
      },
    ]),

    // Low stock items
    Product.find({
      isDeleted: false,
      isActive: true,
      $expr: { $lte: ['$currentStock', '$lowStockThreshold'] },
    })
      .select('name sku currentStock lowStockThreshold category')
      .limit(10)
      .sort('currentStock'),

    // Recent sales
    Transaction.find({ type: 'sale', status: { $ne: 'cancelled' } })
      .select('invoiceNumber customerName total paymentStatus createdAt')
      .populate('customer', 'name')
      .sort('-createdAt')
      .limit(5),

    // Top selling products
    Transaction.aggregate([
      { $match: { createdAt: dateFilter, type: 'sale', status: { $ne: 'cancelled' } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          productName: { $first: '$items.productName' },
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: '$items.subtotal' },
        },
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 5 },
    ]),
  ]);

  const sales = salesData[0] || { totalRevenue: 0, totalPaid: 0, totalBalance: 0, count: 0 };
  const expenses = expenseData[0] || { totalExpenses: 0, count: 0 };
  const products = productStats[0] || { totalProducts: 0, totalStockValue: 0, lowStockCount: 0, outOfStockCount: 0 };
  const customers = customerStats[0] || { total: 0, totalOutstanding: 0 };

  res.json({
    success: true,
    data: {
      period,
      dateRange: { start, end },
      sales: {
        totalRevenue: sales.totalRevenue,
        totalPaid: sales.totalPaid,
        totalBalance: sales.totalBalance,
        transactionCount: sales.count,
        grossProfit: sales.totalRevenue - expenses.totalExpenses,
      },
      expenses: { totalExpenses: expenses.totalExpenses, count: expenses.count },
      inventory: products,
      customers: { total: customers.total, totalOutstanding: customers.totalOutstanding },
      lowStockItems,
      recentSales,
      topProducts,
    },
  });
});

// ─── Sales Report ──────────────────────────────────────────────────────────
exports.getSalesReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, groupBy = 'day', customer } = req.query;

  const matchFilter = {
    type: 'sale',
    status: { $ne: 'cancelled' },
  };
  if (startDate || endDate) {
    matchFilter.createdAt = {};
    if (startDate) matchFilter.createdAt.$gte = new Date(startDate);
    if (endDate) matchFilter.createdAt.$lte = new Date(endDate);
  }
  if (customer) matchFilter.customer = customer;

  const dateGrouping = {
    day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
    week: { $week: '$createdAt' },
    month: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
    year: { $dateToString: { format: '%Y', date: '$createdAt' } },
  };

  const [timeline, byPaymentMethod, byPaymentStatus] = await Promise.all([
    Transaction.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: dateGrouping[groupBy],
          revenue: { $sum: '$total' },
          count: { $sum: 1 },
          avgOrderValue: { $avg: '$total' },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    Transaction.aggregate([
      { $match: matchFilter },
      { $group: { _id: '$paymentMethod', total: { $sum: '$total' }, count: { $sum: 1 } } },
    ]),

    Transaction.aggregate([
      { $match: matchFilter },
      { $group: { _id: '$paymentStatus', total: { $sum: '$total' }, count: { $sum: 1 } } },
    ]),
  ]);

  res.json({ success: true, data: { timeline, byPaymentMethod, byPaymentStatus } });
});

// ─── Expense Report ────────────────────────────────────────────────────────
exports.getExpenseReport = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const matchFilter = { isDeleted: false, status: 'approved' };
  if (startDate || endDate) {
    matchFilter.date = {};
    if (startDate) matchFilter.date.$gte = new Date(startDate);
    if (endDate) matchFilter.date.$lte = new Date(endDate);
  }

  const [byCategory, byMonth, byPaymentMethod] = await Promise.all([
    Expense.aggregate([
      { $match: matchFilter },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),

    Expense.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    Expense.aggregate([
      { $match: matchFilter },
      { $group: { _id: '$paymentMethod', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  res.json({ success: true, data: { byCategory, byMonth, byPaymentMethod } });
});

// ─── Inventory Report ──────────────────────────────────────────────────────
exports.getInventoryReport = asyncHandler(async (req, res) => {
  const [byCategory, stockMovementSummary, valuation] = await Promise.all([
    Product.aggregate([
      { $match: { isDeleted: false, isActive: true } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          totalStock: { $sum: '$currentStock' },
          totalValue: { $sum: { $multiply: ['$currentStock', '$costPrice'] } },
          lowStockCount: {
            $sum: { $cond: [{ $lte: ['$currentStock', '$lowStockThreshold'] }, 1, 0] },
          },
        },
      },
    ]),

    StockMovement.aggregate([
      {
        $group: {
          _id: '$type',
          totalQty: { $sum: { $abs: '$quantity' } },
          count: { $sum: 1 },
        },
      },
    ]),

    Product.aggregate([
      { $match: { isDeleted: false, isActive: true } },
      {
        $group: {
          _id: null,
          totalCostValue: { $sum: { $multiply: ['$currentStock', '$costPrice'] } },
          totalSaleValue: { $sum: { $multiply: ['$currentStock', '$sellingPrice'] } },
          potentialProfit: {
            $sum: {
              $multiply: [
                '$currentStock',
                { $subtract: ['$sellingPrice', '$costPrice'] },
              ],
            },
          },
        },
      },
    ]),
  ]);

  res.json({ success: true, data: { byCategory, stockMovementSummary, valuation: valuation[0] } });
});

// ─── Profit & Loss Report ──────────────────────────────────────────────────
exports.getProfitLoss = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const salesFilter = { type: 'sale', status: { $ne: 'cancelled' } };
  const expenseFilter = { status: 'approved', isDeleted: false };

  if (startDate || endDate) {
    const dateRange = {};
    if (startDate) dateRange.$gte = new Date(startDate);
    if (endDate) dateRange.$lte = new Date(endDate);
    salesFilter.createdAt = dateRange;
    expenseFilter.date = dateRange;
  }

  const [salesAgg, expenseAgg] = await Promise.all([
    Transaction.aggregate([
      { $match: salesFilter },
      {
        $group: {
          _id: null,
          grossRevenue: { $sum: '$total' },
          taxCollected: { $sum: '$taxAmount' },
          discounts: { $sum: '$discountAmount' },
        },
      },
    ]),
    Expense.aggregate([
      { $match: expenseFilter },
      { $group: { _id: '$category', total: { $sum: '$amount' } } },
    ]),
  ]);

  const sales = salesAgg[0] || { grossRevenue: 0, taxCollected: 0, discounts: 0 };
  const totalExpenses = expenseAgg.reduce((sum, e) => sum + e.total, 0);
  const netRevenue = sales.grossRevenue - sales.taxCollected;
  const netProfit = netRevenue - totalExpenses;

  res.json({
    success: true,
    data: {
      revenue: {
        gross: sales.grossRevenue,
        tax: sales.taxCollected,
        discounts: sales.discounts,
        net: netRevenue,
      },
      expenses: {
        total: totalExpenses,
        breakdown: expenseAgg,
      },
      profit: {
        net: netProfit,
        margin: netRevenue > 0 ? parseFloat(((netProfit / netRevenue) * 100).toFixed(2)) : 0,
      },
    },
  });
});
