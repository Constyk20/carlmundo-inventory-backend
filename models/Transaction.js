const mongoose = require('mongoose');

const paymentHistorySchema = new mongoose.Schema(
  {
    amount:        { type: Number, required: true },
    paymentMethod: { type: String },
    notes:         { type: String },
    recordedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    recordedAt:    { type: Date, default: Date.now },
    balanceBefore: { type: Number },
    balanceAfter:  { type: Number },
  },
  { _id: true }
);

const transactionItemSchema = new mongoose.Schema(
  {
    product:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    productName: { type: String, required: true },
    productSku:  { type: String },
    quantity:    { type: Number, required: true, min: 1 },
    unitPrice:   { type: Number, required: true, min: 0 },
    discount:    { type: Number, default: 0, min: 0, max: 100 },
    subtotal:    { type: Number, required: true },
  },
  { _id: true }
);

const transactionSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type:   String,
      unique: true,
    },
    customer:      { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    customerName:  { type: String },
    type: {
      type:    String,
      enum:    ['sale', 'return', 'exchange'],
      default: 'sale',
    },
    status: {
      type:    String,
      enum:    ['draft', 'confirmed', 'cancelled'],
      default: 'confirmed',
    },
    items:         [transactionItemSchema],
    subtotal:      { type: Number, required: true, min: 0 },
    taxRate:       { type: Number, default: 0, min: 0, max: 100 },
    taxAmount:     { type: Number, default: 0, min: 0 },
    total:         { type: Number, required: true, min: 0 },
    amountPaid:    { type: Number, default: 0, min: 0 },
    balance:       { type: Number, default: 0, min: 0 },
    paymentMethod: {
      type:    String,
      enum:    ['cash', 'transfer', 'cheque', 'credit', 'pos', 'card', 'cancellation'],
      default: 'cash',
    },
    paymentStatus: {
      type:    String,
      enum:    ['paid', 'partial', 'unpaid', 'cancelled'], // Added 'cancelled'
      default: 'paid',
    },
    paymentHistory: [paymentHistorySchema],
    notes:     { type: String },
    dueDate:   { type: Date },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Auto-generate invoice number
transactionSchema.pre('save', async function (next) {
  if (!this.invoiceNumber) {
    const count = await mongoose.model('Transaction').countDocuments();
    const pad   = String(count + 1).padStart(5, '0');
    const year  = new Date().getFullYear().toString().slice(-2);
    this.invoiceNumber = `INV-${year}-${pad}`;
  }
  next();
});

transactionSchema.index({ customer: 1, createdAt: -1 });
transactionSchema.index({ paymentStatus: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ balance: 1 });
transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ invoiceNumber: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);