const ExcelJS = require('exceljs');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Transaction = require('../models/Transaction');
const Expense = require('../models/Expense');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const { audit } = require('../utils/audit');
const { PRODUCT_CATEGORIES } = require('../models/Product');

const HEADER_STYLE = {
  font: { bold: true, color: { argb: 'FFFFFFFF' } },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } },
  alignment: { horizontal: 'center', vertical: 'middle' },
  border: {
    bottom: { style: 'medium', color: { argb: 'FF1E3A5F' } },
  },
};

const applyHeaders = (sheet, headers) => {
  sheet.addRow(headers).eachCell((cell) => Object.assign(cell, HEADER_STYLE));
  sheet.getRow(1).height = 22;
};

// ─── Export Products ───────────────────────────────────────────────────────
exports.exportProducts = asyncHandler(async (req, res) => {
  const products = await Product.find({ isDeleted: false })
    .populate('createdBy', 'name')
    .lean();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Inventory App';
  wb.created = new Date();

  const ws = wb.addWorksheet('Products', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { key: 'sku', width: 15 },
    { key: 'name', width: 30 },
    { key: 'category', width: 20 },
    { key: 'unit', width: 12 },
    { key: 'currentStock', width: 15 },
    { key: 'lowStockThreshold', width: 18 },
    { key: 'costPrice', width: 14 },
    { key: 'sellingPrice', width: 14 },
    { key: 'stockValue', width: 14 },
    { key: 'isActive', width: 12 },
    { key: 'supplier', width: 20 },
    { key: 'createdAt', width: 18 },
  ];

  applyHeaders(ws, [
    'SKU', 'Name', 'Category', 'Unit', 'Current Stock',
    'Low Stock Threshold', 'Cost Price (₦)', 'Selling Price (₦)',
    'Stock Value (₦)', 'Active', 'Supplier', 'Created At',
  ]);

  products.forEach((p) => {
    const row = ws.addRow({
      sku: p.sku,
      name: p.name,
      category: p.category,
      unit: p.unit,
      currentStock: p.currentStock,
      lowStockThreshold: p.lowStockThreshold,
      costPrice: p.costPrice,
      sellingPrice: p.sellingPrice,
      stockValue: p.currentStock * p.costPrice,
      isActive: p.isActive ? 'Yes' : 'No',
      supplier: p.supplier?.name || '',
      createdAt: p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '',
    });

    // Highlight low stock
    if (p.currentStock <= p.lowStockThreshold) {
      row.getCell('currentStock').fill = {
        type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0E0' },
      };
    }
  });

  // Auto-filter
  ws.autoFilter = { from: 'A1', to: `L1` };

  await audit(req, { action: 'export', entity: 'Product', meta: { count: products.length } });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=products_${Date.now()}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
});

// ─── Import Products ───────────────────────────────────────────────────────
exports.importProducts = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('Please upload an Excel file.', 400);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(req.file.buffer);
  const ws = wb.getWorksheet(1);

  if (!ws) throw new AppError('No worksheet found in file.', 400);

  const errors = [];
  const toUpsert = [];
  let rowNumber = 1;

  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header
    rowNumber = rowNum;

    const [sku, name, category, unit, currentStock, lowStockThreshold, costPrice, sellingPrice] =
      row.values.slice(1);

    if (!sku || !name || !category) {
      errors.push({ row: rowNum, message: 'SKU, Name, and Category are required.' });
      return;
    }

    if (!PRODUCT_CATEGORIES.includes(category)) {
      errors.push({ row: rowNum, message: `Invalid category: ${category}` });
      return;
    }

    toUpsert.push({
      sku: String(sku).toUpperCase().trim(),
      name: String(name).trim(),
      category,
      unit: unit || 'piece',
      currentStock: Number(currentStock) || 0,
      lowStockThreshold: Number(lowStockThreshold) || 10,
      costPrice: Number(costPrice) || 0,
      sellingPrice: Number(sellingPrice) || 0,
      updatedBy: req.user._id,
    });
  });

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Import failed due to validation errors.',
      errors,
    });
  }

  let created = 0, updated = 0;
  for (const item of toUpsert) {
    const existing = await Product.findOne({ sku: item.sku });
    if (existing) {
      await Product.findByIdAndUpdate(existing._id, item);
      updated++;
    } else {
      await Product.create({ ...item, createdBy: req.user._id });
      created++;
    }
  }

  await audit(req, {
    action: 'import',
    entity: 'Product',
    meta: { created, updated, totalRows: toUpsert.length },
  });

  res.json({
    success: true,
    message: `Import complete. Created: ${created}, Updated: ${updated}.`,
    data: { created, updated, total: toUpsert.length },
  });
});

// ─── Export Transactions ───────────────────────────────────────────────────
exports.exportTransactions = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const filter = { type: 'sale' };
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  const transactions = await Transaction.find(filter)
    .populate('customer', 'name')
    .lean();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Transactions', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { key: 'invoice', width: 20 }, { key: 'date', width: 15 },
    { key: 'customer', width: 25 }, { key: 'status', width: 12 },
    { key: 'subtotal', width: 15 }, { key: 'tax', width: 12 },
    { key: 'total', width: 15 }, { key: 'paid', width: 15 },
    { key: 'balance', width: 15 }, { key: 'paymentMethod', width: 18 },
    { key: 'paymentStatus', width: 16 },
  ];

  applyHeaders(ws, [
    'Invoice #', 'Date', 'Customer', 'Status', 'Subtotal (₦)',
    'Tax (₦)', 'Total (₦)', 'Amount Paid (₦)', 'Balance (₦)',
    'Payment Method', 'Payment Status',
  ]);

  transactions.forEach((t) => {
    ws.addRow({
      invoice: t.invoiceNumber,
      date: new Date(t.createdAt).toLocaleDateString(),
      customer: t.customer?.name || t.customerName || 'Walk-in',
      status: t.status,
      subtotal: t.subtotal,
      tax: t.taxAmount,
      total: t.total,
      paid: t.amountPaid,
      balance: t.balance,
      paymentMethod: t.paymentMethod,
      paymentStatus: t.paymentStatus,
    });
  });

  // Total row
  const totalRow = ws.addRow({
    invoice: 'TOTAL', total: transactions.reduce((s, t) => s + t.total, 0),
    paid: transactions.reduce((s, t) => s + t.amountPaid, 0),
    balance: transactions.reduce((s, t) => s + t.balance, 0),
  });
  totalRow.font = { bold: true };

  ws.autoFilter = { from: 'A1', to: 'K1' };

  await audit(req, { action: 'export', entity: 'Transaction', meta: { count: transactions.length } });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=transactions_${Date.now()}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
});

// ─── Export Expenses ───────────────────────────────────────────────────────
exports.exportExpenses = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const filter = { isDeleted: false, status: 'approved' };
  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate) filter.date.$lte = new Date(endDate);
  }

  const expenses = await Expense.find(filter).populate('createdBy', 'name').lean();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Expenses', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { key: 'code', width: 15 }, { key: 'date', width: 15 },
    { key: 'title', width: 30 }, { key: 'category', width: 20 },
    { key: 'vendor', width: 20 }, { key: 'amount', width: 15 },
    { key: 'paymentMethod', width: 18 }, { key: 'createdBy', width: 20 },
  ];

  applyHeaders(ws, ['Code', 'Date', 'Title', 'Category', 'Vendor', 'Amount (₦)', 'Payment Method', 'Created By']);

  expenses.forEach((e) => {
    ws.addRow({
      code: e.expenseCode,
      date: new Date(e.date).toLocaleDateString(),
      title: e.title,
      category: e.category,
      vendor: e.vendor || '',
      amount: e.amount,
      paymentMethod: e.paymentMethod,
      createdBy: e.createdBy?.name || '',
    });
  });

  const totalRow = ws.addRow({ title: 'TOTAL', amount: expenses.reduce((s, e) => s + e.amount, 0) });
  totalRow.font = { bold: true };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=expenses_${Date.now()}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
});

// ─── Export Customers ─────────────────────────────────────────────────────
exports.exportCustomers = asyncHandler(async (req, res) => {
  const Customer = require('../models/Customer');
  const customers = await Customer.find({ isDeleted: false }).lean();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Customers', { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { key: 'code', width: 15 }, { key: 'name', width: 30 },
    { key: 'type', width: 14 }, { key: 'email', width: 28 },
    { key: 'phone', width: 18 }, { key: 'city', width: 18 },
    { key: 'state', width: 18 }, { key: 'creditLimit', width: 16 },
    { key: 'balance', width: 16 }, { key: 'paymentTerms', width: 18 },
    { key: 'isActive', width: 10 },
  ];

  applyHeaders(ws, [
    'Code', 'Name', 'Type', 'Email', 'Phone', 'City', 'State',
    'Credit Limit (₦)', 'Balance (₦)', 'Payment Terms', 'Active',
  ]);

  customers.forEach((c) => {
    ws.addRow({
      code: c.customerCode, name: c.name, type: c.type,
      email: c.email || '', phone: c.phone || '',
      city: c.address?.city || '', state: c.address?.state || '',
      creditLimit: c.creditLimit, balance: c.currentBalance,
      paymentTerms: c.paymentTerms, isActive: c.isActive ? 'Yes' : 'No',
    });
  });

  ws.autoFilter = { from: 'A1', to: 'K1' };
  await audit(req, { action: 'export', entity: 'Customer', meta: { count: customers.length } });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=customers_${Date.now()}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
});

// ─── Import Customers ─────────────────────────────────────────────────────
exports.importCustomers = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('Please upload an Excel file.', 400);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(req.file.buffer);
  const ws = wb.getWorksheet(1);
  if (!ws) throw new AppError('No worksheet found in file.', 400);

  const Customer = require('../models/Customer');
  const errors = [];
  const toUpsert = [];

  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const [name, type, email, phone, city, state, creditLimit, paymentTerms] = row.values.slice(1);
    if (!name) { errors.push({ row: rowNum, message: 'Name is required.' }); return; }

    toUpsert.push({
      name:         String(name).trim(),
      type:         type || 'business',
      email:        email ? String(email).toLowerCase().trim() : undefined,
      phone:        phone ? String(phone).trim() : undefined,
      address:      { city: city || '', state: state || '' },
      creditLimit:  Number(creditLimit) || 0,
      paymentTerms: paymentTerms || 'immediate',
    });
  });

  if (errors.length) return res.status(400).json({ success: false, message: 'Validation errors.', errors });

  let created = 0, updated = 0;
  for (const item of toUpsert) {
    if (item.email) {
      const existing = await Customer.findOne({ email: item.email });
      if (existing) { await Customer.findByIdAndUpdate(existing._id, { ...item, updatedBy: req.user._id }); updated++; continue; }
    }
    await Customer.create({ ...item, createdBy: req.user._id });
    created++;
  }

  await audit(req, { action: 'import', entity: 'Customer', meta: { created, updated } });
  res.json({ success: true, message: `Import complete. Created: ${created}, Updated: ${updated}.`, data: { created, updated } });
});

// ─── Download Import Template ──────────────────────────────────────────────
exports.getImportTemplate = asyncHandler(async (req, res) => {
  const { type = 'products' } = req.query;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(type.charAt(0).toUpperCase() + type.slice(1));

  if (type === 'customers') {
    ws.columns = [
      { key: 'name', width: 30 }, { key: 'type', width: 14 },
      { key: 'email', width: 28 }, { key: 'phone', width: 18 },
      { key: 'city', width: 18 }, { key: 'state', width: 18 },
      { key: 'creditLimit', width: 16 }, { key: 'paymentTerms', width: 18 },
    ];
    applyHeaders(ws, ['Name *', 'Type', 'Email', 'Phone', 'City', 'State', 'Credit Limit', 'Payment Terms']);
    ws.addRow({ name: 'Sunshine Bakery', type: 'business', email: 'info@sunshine.com',
      phone: '08012345678', city: 'Lagos', state: 'Lagos', creditLimit: 50000, paymentTerms: 'net_30' });

    const notesWs = wb.addWorksheet('Notes');
    notesWs.addRow(['Field', 'Required', 'Allowed Values']);
    notesWs.addRow(['Name', 'Yes', 'Customer name']);
    notesWs.addRow(['Type', 'No', 'individual, business']);
    notesWs.addRow(['Payment Terms', 'No', 'immediate, net_7, net_14, net_30, net_60']);
  } else if (type === 'products') {
    ws.columns = [
      { key: 'sku', width: 15 }, { key: 'name', width: 30 },
      { key: 'category', width: 20 }, { key: 'unit', width: 12 },
      { key: 'currentStock', width: 15 }, { key: 'lowStockThreshold', width: 18 },
      { key: 'costPrice', width: 14 }, { key: 'sellingPrice', width: 14 },
    ];

    applyHeaders(ws, ['SKU *', 'Name *', 'Category *', 'Unit', 'Current Stock', 'Low Stock Threshold', 'Cost Price', 'Selling Price']);

    // Sample row
    ws.addRow({
      sku: 'CB-001', name: 'Standard Cake Box 8"', category: 'cake_box',
      unit: 'piece', currentStock: 100, lowStockThreshold: 20,
      costPrice: 150, sellingPrice: 250,
    });

    // Notes
    const notesWs = wb.addWorksheet('Notes');
    notesWs.addRow(['Field', 'Required', 'Allowed Values']);
    notesWs.addRow(['SKU', 'Yes', 'Unique identifier']);
    notesWs.addRow(['Name', 'Yes', 'Product name']);
    notesWs.addRow(['Category', 'Yes', PRODUCT_CATEGORIES.join(', ')]);
    notesWs.addRow(['Unit', 'No', 'piece, pack, carton, roll, sheet']);
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${type}_import_template.xlsx`);
  await wb.xlsx.write(res);
  res.end();
});
