const mongoose = require('mongoose');
const { ROLES } = require('../config/constants');

const registrationRequestSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    phone: { type: String, trim: true },
    requestedRole: {
      type: String,
      enum: Object.values(ROLES).filter((r) => r !== 'admin'),
      default: ROLES.STAFF,
    },
    reason: {
      type: String,
      trim: true,
      maxlength: [500, 'Reason cannot exceed 500 characters'],
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String },
    // Once approved, link to the created user
    createdUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

registrationRequestSchema.index({ status: 1, createdAt: -1 });
registrationRequestSchema.index({ email: 1 });

module.exports = mongoose.model('RegistrationRequest', registrationRequestSchema);