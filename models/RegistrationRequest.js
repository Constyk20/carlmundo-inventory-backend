const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const { ROLES } = require('../config/constants');

const registrationRequestSchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: [true, 'Name is required'],
      trim:     true,
    },
    email: {
      type:     String,
      required: [true, 'Email is required'],
      unique:   true,
      lowercase: true,
      trim:     true,
      match:    [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    // Store hashed password — used when admin approves the request
    password: {
      type:     String,
      required: [true, 'Password is required'],
      select:   false, // never returned in queries
    },
    phone: { type: String, trim: true },
    requestedRole: {
      type:    String,
      enum:    Object.values(ROLES).filter((r) => r !== 'admin'),
      default: ROLES.SUPERVISOR,
    },
    reason: {
      type:      String,
      trim:      true,
      maxlength: [500, 'Reason cannot exceed 500 characters'],
    },
    status: {
      type:    String,
      enum:    ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    reviewedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt:      { type: Date },
    rejectionReason: { type: String },
    createdUser:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Hash password before saving
registrationRequestSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

registrationRequestSchema.index({ status: 1, createdAt: -1 });
// email index already created by unique: true above

module.exports = mongoose.model('RegistrationRequest', registrationRequestSchema);
