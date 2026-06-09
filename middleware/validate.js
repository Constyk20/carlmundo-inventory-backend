const Joi = require('joi');
const { ROLES, PERMISSIONS } = require('../config/constants');
const { PRODUCT_CATEGORIES } = require('../models/Product');
const { EXPENSE_CATEGORIES } = require('../models/Expense');

// ─── Reusable schemas ──────────────────────────────────────────────────────
const objectId = Joi.string().pattern(/^[0-9a-fA-F]{24}$/).message('Invalid ID format');
const password = Joi.string()
  .min(8)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
  .message('Password must include uppercase, lowercase, number, and special character');

// ─── Auth ──────────────────────────────────────────────────────────────────
const schemas = {
  login: Joi.object({
    email: Joi.string().email().required().lowercase(),
    password: Joi.string().required(),
  }),

  register: Joi.object({
    name: Joi.string().min(2).max(100).required().trim(),
    email: Joi.string().email().required().lowercase(),
    password: password.required(),
    role: Joi.string().valid(...Object.values(ROLES)).default(ROLES.STAFF),
    permissions: Joi.array().items(Joi.string().valid(...Object.values(PERMISSIONS))),
  }),

  refreshToken: Joi.object({
    refreshToken: Joi.string().required(),
  }),

  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: password.required(),
  }),

  // ─── User ──────────────────────────────────────────────────────────────
  updateUser: Joi.object({
    name: Joi.string().min(2).max(100).trim(),
    email: Joi.string().email().lowercase(),
    role: Joi.string().valid(...Object.values(ROLES)),
    permissions: Joi.array().items(Joi.string().valid(...Object.values(PERMISSIONS))),
    isActive: Joi.boolean(),
    restrictedFeatures: Joi.array().items(Joi.string()),
  }),

  // ─── Product ────────────────────────────────────────────────────────────
  createProduct: Joi.object({
    sku: Joi.string().uppercase().trim().required(),
    name: Joi.string().trim().required(),
    description: Joi.string().trim().allow(''),
    category: Joi.string().valid(...PRODUCT_CATEGORIES).required(),
    unit: Joi.string().valid('piece', 'pack', 'carton', 'roll', 'sheet').default('piece'),
    currentStock: Joi.number().min(0).default(0),
    lowStockThreshold: Joi.number().min(0).default(10),
    maxStockLevel: Joi.number().min(0),
    costPrice: Joi.number().min(0).default(0),
    sellingPrice: Joi.number().min(0).default(0),
    dimensions: Joi.object({
      length: Joi.number().min(0),
      width: Joi.number().min(0),
      height: Joi.number().min(0),
      unit: Joi.string().valid('cm', 'mm', 'inch').default('cm'),
    }),
    weight: Joi.number().min(0),
    supplier: Joi.object({
      name: Joi.string(),
      contactEmail: Joi.string().email(),
      contactPhone: Joi.string(),
      leadTimeDays: Joi.number().min(0),
    }),
  }),

  updateProduct: Joi.object({
    name: Joi.string().trim(),
    description: Joi.string().trim().allow(''),
    category: Joi.string().valid(...PRODUCT_CATEGORIES),
    unit: Joi.string().valid('piece', 'pack', 'carton', 'roll', 'sheet'),
    lowStockThreshold: Joi.number().min(0),
    maxStockLevel: Joi.number().min(0),
    costPrice: Joi.number().min(0),
    sellingPrice: Joi.number().min(0),
    dimensions: Joi.object({
      length: Joi.number().min(0),
      width: Joi.number().min(0),
      height: Joi.number().min(0),
      unit: Joi.string().valid('cm', 'mm', 'inch'),
    }),
    weight: Joi.number().min(0),
    supplier: Joi.object({
      name: Joi.string(),
      contactEmail: Joi.string().email(),
      contactPhone: Joi.string(),
      leadTimeDays: Joi.number().min(0),
    }),
    isActive: Joi.boolean(),
    priceChangeReason: Joi.string(),
  }),

  adjustStock: Joi.object({
    type: Joi.string().valid('purchase', 'adjustment', 'return', 'damage', 'transfer', 'production_use').required(),
    quantity: Joi.number().required(),
    unitCost: Joi.number().min(0),
    reference: Joi.string(),
    notes: Joi.string(),
  }),

  // ─── Customer ────────────────────────────────────────────────────────────
  createCustomer: Joi.object({
    name: Joi.string().trim().required(),
    type: Joi.string().valid('individual', 'business').default('business'),
    email: Joi.string().email().lowercase().allow('', null),
    phone: Joi.string().trim().allow('', null),
    alternatePhone: Joi.string().trim().allow('', null),
    address: Joi.object({
      street: Joi.string(),
      city: Joi.string(),
      state: Joi.string(),
      country: Joi.string().default('Nigeria'),
      postalCode: Joi.string(),
    }),
    taxId: Joi.string().allow('', null),
    creditLimit: Joi.number().min(0).default(0),
    paymentTerms: Joi.string().valid('immediate', 'net_7', 'net_14', 'net_30', 'net_60'),
    notes: Joi.string().allow('', null),
    tags: Joi.array().items(Joi.string()),
  }),

  // ─── Transaction ─────────────────────────────────────────────────────────
  createTransaction: Joi.object({
    customer: objectId.allow('', null),
    customerName: Joi.string().when('customer', {
      is: Joi.exist(),
      then: Joi.optional(),
      otherwise: Joi.required(),
    }),
    type: Joi.string().valid('sale', 'return', 'quotation').default('sale'),
    items: Joi.array()
      .items(
        Joi.object({
          product: objectId.required(),
          quantity: Joi.number().integer().min(1).required(),
          unitPrice: Joi.number().min(0).required(),
          discount: Joi.number().min(0).max(100).default(0),
        })
      )
      .min(1)
      .required(),
    taxRate: Joi.number().min(0).max(100).default(0),
    paymentMethod: Joi.string().valid('cash', 'transfer', 'cheque', 'credit', 'pos').default('cash'),
    amountPaid: Joi.number().min(0),
    notes: Joi.string().allow('', null),
    dueDate: Joi.date().iso(),
    deliveryDate: Joi.date().iso(),
  }),

  // ─── Expense ─────────────────────────────────────────────────────────────
  createExpense: Joi.object({
    title: Joi.string().trim().required(),
    description: Joi.string().trim().allow('', null),
    category: Joi.string().valid(...EXPENSE_CATEGORIES).required(),
    amount: Joi.number().min(0).required(),
    currency: Joi.string().default('NGN'),
    date: Joi.date().iso().default(() => new Date()),
    paymentMethod: Joi.string().valid('cash', 'transfer', 'cheque', 'card').default('cash'),
    vendor: Joi.string().trim().allow('', null),
    receiptUrl: Joi.string().uri().allow('', null),
    isRecurring: Joi.boolean().default(false),
    recurringPeriod: Joi.string().valid('daily', 'weekly', 'monthly', 'quarterly', 'yearly')
      .when('isRecurring', { is: true, then: Joi.required() }),
    tags: Joi.array().items(Joi.string()),
  }),

  // ─── Registration Request ─────────────────────────────────────────────
  submitRegistrationRequest: Joi.object({
  name:          Joi.string().min(2).max(100).trim().required(),
  email:         Joi.string().email().lowercase().required(),
  password:      Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
    .message('Password must include uppercase, lowercase, number and special character')
    .required(),
  phone:         Joi.string().trim().allow('', null),
  requestedRole: Joi.string()
    .valid('manager', 'production_manager', 'accountant', 'staff', 'viewer')
    .default('staff'),
  reason:        Joi.string().max(500).trim().allow('', null),
}),
  approveRegistrationRequest: Joi.object({
    role:        Joi.string().valid('manager', 'production_manager', 'accountant', 'staff', 'viewer'),
    permissions: Joi.array().items(Joi.string()),
  }),

  rejectRegistrationRequest: Joi.object({
    reason: Joi.string().min(5).max(500).required(),
  }),

  approveExpense: Joi.object({
    action: Joi.string().valid('approve', 'reject').required(),
    rejectionReason: Joi.string().when('action', {
      is: 'reject',
      then: Joi.required(),
    }),
  }),

  // ─── Pagination ──────────────────────────────────────────────────────────
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string().default('-createdAt'),
    search: Joi.string().trim().allow(''),
  }).unknown(true), // allow extra filter fields
};

const validate = (schema, source = 'body') => (req, res, next) => {
  const data = source === 'query' ? req.query : req.body;
  const { error, value } = schema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    const errors = error.details.map((d) => d.message.replace(/['"]/g, ''));
    return res.status(400).json({ success: false, message: 'Validation failed', errors });
  }
  if (source === 'query') {
    req.query = value;
  } else {
    req.body = value;
  }
  next();
};

module.exports = { validate, schemas };