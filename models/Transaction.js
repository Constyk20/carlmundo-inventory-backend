const mongoose = require('mongoose');

const transactionItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String }, // denormalized
    productSku: { type: String },  // denormalized
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 }, // percentage
    subtotal: { type: Number, required: true },
  },
  { _id: false }
);

const transactionSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      unique: true,
      uppercase: true,
    },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    customerName: { type: String }, // denormalized for walk-in customers
    type: {
      type: String,
      enum: ['sale', 'return', 'quotation'],
      default: 'sale',
    },
    status: {
      type: String,
      enum: ['draft', 'confirmed', 'delivered', 'cancelled', 'refunded'],
      default: 'confirmed',
    },
    items: {
      type: [transactionItemSchema],
      validate: [(v) => v.length > 0, 'At least one item is required'],
    },
    subtotal: { type: Number, required: true },
    discountAmount: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0 },    // percentage
    taxAmount: { type: Number, default: 0 },
    total: { type: Number, required: true },
    amountPaid: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    paymentMethod: {
      type: String,
      enum: ['cash', 'transfer', 'cheque', 'credit', 'pos'],
      default: 'cash',
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'partial', 'paid'],
      default: 'paid',
    },
    notes: { type: String },
    dueDate: { type: Date },
    deliveryDate: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelReason: { type: String },
  },
  { timestamps: true }
);

// Auto-generate invoice number
transactionSchema.pre('save', async function (next) {
  if (!this.invoiceNumber) {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const count = await mongoose.model('Transaction').countDocuments();
    this.invoiceNumber = `INV-${year}${month}-${String(count + 1).padStart(5, '0')}`;
  }
  next();
});

// invoiceNumber index created by unique:true above
transactionSchema.index({ customer: 1, createdAt: -1 });
transactionSchema.index({ status: 1, paymentStatus: 1 });
transactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
