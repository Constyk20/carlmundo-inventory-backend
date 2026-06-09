const mongoose = require('mongoose');

const EXPENSE_CATEGORIES = [
  'raw_materials', 'utilities', 'rent', 'salaries', 'transport',
  'maintenance', 'marketing', 'office_supplies', 'packaging', 'other',
];

const expenseSchema = new mongoose.Schema(
  {
    expenseCode: { type: String, unique: true, uppercase: true },
    title: {
      type: String,
      required: [true, 'Expense title is required'],
      trim: true,
    },
    description: { type: String, trim: true },
    category: {
      type: String,
      enum: EXPENSE_CATEGORIES,
      required: [true, 'Category is required'],
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0, 'Amount cannot be negative'],
    },
    currency: { type: String, default: 'NGN' },
    date: { type: Date, required: true, default: Date.now },
    paymentMethod: {
      type: String,
      enum: ['cash', 'transfer', 'cheque', 'card'],
      default: 'cash',
    },
    vendor: { type: String, trim: true },
    receiptUrl: { type: String },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    rejectionReason: { type: String },
    isRecurring: { type: Boolean, default: false },
    recurringPeriod: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
    },
    tags: [{ type: String }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

expenseSchema.pre('save', async function (next) {
  if (!this.expenseCode) {
    const count = await mongoose.model('Expense').countDocuments();
    this.expenseCode = `EXP-${String(count + 1).padStart(6, '0')}`;
  }
  next();
});

expenseSchema.index({ category: 1, date: -1 });
expenseSchema.index({ status: 1 });
expenseSchema.index({ createdBy: 1, date: -1 });
expenseSchema.index({ date: -1 });

module.exports = mongoose.model('Expense', expenseSchema);
module.exports.EXPENSE_CATEGORIES = EXPENSE_CATEGORIES;
