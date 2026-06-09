const mongoose = require('mongoose');

const stockMovementSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    type: {
      type: String,
      enum: ['purchase', 'sale', 'adjustment', 'return', 'damage', 'transfer', 'production_use'],
      required: true,
    },
    quantity: { type: Number, required: true }, // positive = in, negative = out
    quantityBefore: { type: Number, required: true },
    quantityAfter: { type: Number, required: true },
    unitCost: { type: Number, default: 0 },
    reference: { type: String }, // PO number, invoice, etc.
    notes: { type: String },
    relatedTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

stockMovementSchema.index({ product: 1, createdAt: -1 });
stockMovementSchema.index({ type: 1 });
stockMovementSchema.index({ performedBy: 1 });
stockMovementSchema.index({ createdAt: -1 });

module.exports = mongoose.model('StockMovement', stockMovementSchema);
