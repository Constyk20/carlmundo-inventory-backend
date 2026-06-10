const mongoose = require('mongoose');

const materialMovementSchema = new mongoose.Schema(
  {
    material: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'RawMaterial',
      required: true,
    },
    type: {
      type: String,
      enum: ['purchase', 'used_in_production', 'adjustment', 'damage', 'return'],
      required: true,
    },
    quantity:       { type: Number, required: true },
    quantityBefore: { type: Number, required: true },
    quantityAfter:  { type: Number, required: true },
    unitCost:       { type: Number, default: 0 },
    reference:      { type: String },   // PO number, batch ref, etc.
    notes:          { type: String },
    // If used in production, link to the product it was used to make
    relatedProduct: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'Product',
    },
    batchQuantity: { type: Number }, // how many products were made in this run
    performedBy: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },
  },
  { timestamps: true }
);

materialMovementSchema.index({ material: 1, createdAt: -1 });
materialMovementSchema.index({ type: 1 });
materialMovementSchema.index({ createdAt: -1 });

module.exports = mongoose.model('MaterialMovement', materialMovementSchema);