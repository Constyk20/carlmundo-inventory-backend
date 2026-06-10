const mongoose = require('mongoose');

const MATERIAL_CATEGORIES = [
  'cake_box',
  'cupcake_box',
  'doughnut_box',
  'popcorn_pack',
  'pastry_box',
  'gift_box',
  'carrier_bag',
  'other',
];

const priceHistorySchema = new mongoose.Schema(
  {
    price:     { type: Number, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason:    { type: String },
  },
  { timestamps: true, _id: false }
);

const rawMaterialSchema = new mongoose.Schema(
  {
    // e.g. "10\" Low Cover", "PVC Sheet", "8\" Body"
    name: {
      type:     String,
      required: [true, 'Material name is required'],
      trim:     true,
    },
    // short code e.g. "10LC", "PVC-A4"
    code: {
      type:      String,
      unique:    true,
      uppercase: true,
      trim:      true,
    },
    category: {
      type:     String,
      enum:     MATERIAL_CATEGORIES,
      required: [true, 'Category is required'],
    },
    description: { type: String, trim: true },
    unit: {
      type:    String,
      enum:    ['piece', 'pack', 'sheet', 'roll', 'kg', 'litre', 'metre'],
      default: 'piece',
    },
    // Current quantity in stock
    currentQuantity: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 10 },
    // Cost per unit
    unitCost: { type: Number, default: 0, min: 0 },
    priceHistory: [priceHistorySchema],
    supplier: {
      name:         { type: String },
      contactPhone: { type: String },
      contactEmail: { type: String },
    },
    isActive:  { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Auto-generate code if not provided
rawMaterialSchema.pre('save', async function (next) {
  if (!this.code) {
    const count = await mongoose.model('RawMaterial').countDocuments();
    const prefix = this.category.slice(0, 3).toUpperCase();
    this.code = `${prefix}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

rawMaterialSchema.virtual('isLowStock').get(function () {
  return this.currentQuantity <= this.lowStockThreshold;
});

rawMaterialSchema.index({ category: 1, isActive: 1 });
rawMaterialSchema.index({ name: 'text', code: 'text' });

module.exports = mongoose.model('RawMaterial', rawMaterialSchema);
module.exports.MATERIAL_CATEGORIES = MATERIAL_CATEGORIES;