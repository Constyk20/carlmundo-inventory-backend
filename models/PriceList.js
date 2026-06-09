const mongoose = require('mongoose');

/**
 * PriceList lets you define named price tiers (e.g. "Wholesale", "Retail",
 * "VIP") with per-product overrides, and optionally link them to customers.
 */
const priceEntrySchema = new mongoose.Schema(
  {
    product:      { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName:  { type: String },   // denormalized for display
    productSku:   { type: String },
    price:        { type: Number, required: true, min: 0 },
    minQty:       { type: Number, default: 1 },  // minimum qty to qualify
    discount:     { type: Number, default: 0, min: 0, max: 100 }, // % off base
  },
  { _id: false }
);

const priceListSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Price list name is required'],
      trim: true,
      unique: true,
    },
    description: { type: String, trim: true },
    type: {
      type: String,
      enum: ['retail', 'wholesale', 'vip', 'custom'],
      default: 'custom',
    },
    currency: { type: String, default: 'NGN' },
    // Global discount applied on top of individual prices (%)
    globalDiscount: { type: Number, default: 0, min: 0, max: 100 },
    entries: [priceEntrySchema],
    // Customers assigned to this price list
    assignedCustomers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }],
    validFrom:  { type: Date },
    validUntil: { type: Date },
    isActive:   { type: Boolean, default: true },
    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// name index is created by unique:true above
priceListSchema.index({ isActive: 1 });
priceListSchema.index({ assignedCustomers: 1 });

module.exports = mongoose.model('PriceList', priceListSchema);
