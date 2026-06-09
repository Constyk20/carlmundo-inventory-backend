const mongoose = require('mongoose');

const PRODUCT_CATEGORIES = ['cake_box', 'pastry_box', 'gift_box', 'carrier_bag', 'wrapper', 'label', 'other'];

const priceHistorySchema = new mongoose.Schema(
  {
    price: { type: Number, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String },
  },
  { timestamps: true, _id: false }
);

const productSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      required: [true, 'SKU is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
    },
    description: { type: String, trim: true },
    category: {
      type: String,
      enum: PRODUCT_CATEGORIES,
      required: [true, 'Category is required'],
    },
    unit: {
      type: String,
      enum: ['piece', 'pack', 'carton', 'roll', 'sheet'],
      default: 'piece',
    },

    // Stock
    currentStock: { type: Number, default: 0, min: 0 },
    reservedStock: { type: Number, default: 0, min: 0 }, // committed to orders
    lowStockThreshold: { type: Number, default: 10 },
    maxStockLevel: { type: Number },

    // Pricing
    costPrice: { type: Number, default: 0, min: 0 },  // buying price
    sellingPrice: { type: Number, default: 0, min: 0 }, // selling price
    priceHistory: [priceHistorySchema],

    // Physical attributes
    dimensions: {
      length: { type: Number },
      width: { type: Number },
      height: { type: Number },
      unit: { type: String, enum: ['cm', 'mm', 'inch'], default: 'cm' },
    },
    weight: { type: Number }, // grams

    // Supplier info
    supplier: {
      name: { type: String },
      contactEmail: { type: String },
      contactPhone: { type: String },
      leadTimeDays: { type: Number },
    },

    // Images (store URLs or file paths)
    images: [{ type: String }],

    // Status
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Indexes — sku index is created by unique:true above
productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ name: 'text', description: 'text', sku: 'text' });
productSchema.index({ currentStock: 1, lowStockThreshold: 1 });
productSchema.index({ isDeleted: 1, isActive: 1 });

// Virtual: available stock
productSchema.virtual('availableStock').get(function () {
  return Math.max(0, this.currentStock - this.reservedStock);
});

// Virtual: low stock flag
productSchema.virtual('isLowStock').get(function () {
  return this.currentStock <= this.lowStockThreshold;
});

// Virtual: stock value (cost)
productSchema.virtual('stockValue').get(function () {
  return this.currentStock * this.costPrice;
});

productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Product', productSchema);
module.exports.PRODUCT_CATEGORIES = PRODUCT_CATEGORIES;
