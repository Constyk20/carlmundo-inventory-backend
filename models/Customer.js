const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
  {
    customerCode: {
      type: String,
      unique: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, 'Customer name is required'],
      trim: true,
    },
    type: {
      type: String,
      enum: ['individual', 'business'],
      default: 'business',
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    phone: { type: String, trim: true },
    alternatePhone: { type: String, trim: true },
    address: {
      street: { type: String },
      city: { type: String },
      state: { type: String },
      country: { type: String, default: 'Nigeria' },
      postalCode: { type: String },
    },
    taxId: { type: String }, // VAT / TIN number
    creditLimit: { type: Number, default: 0 },
    currentBalance: { type: Number, default: 0 }, // outstanding balance
    paymentTerms: {
      type: String,
      enum: ['immediate', 'net_7', 'net_14', 'net_30', 'net_60'],
      default: 'immediate',
    },
    notes: { type: String },
    tags: [{ type: String }],
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Auto-generate customer code
customerSchema.pre('save', async function (next) {
  if (!this.customerCode) {
    const count = await mongoose.model('Customer').countDocuments();
    this.customerCode = `CUST-${String(count + 1).padStart(5, '0')}`;
  }
  next();
});

customerSchema.index({ name: 'text', email: 'text', customerCode: 'text' });
customerSchema.index({ isActive: 1, isDeleted: 1 });

// Virtual: total purchases
customerSchema.virtual('totalPurchases', {
  ref: 'Transaction',
  localField: '_id',
  foreignField: 'customer',
  count: true,
});

module.exports = mongoose.model('Customer', customerSchema);
