const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, ROLE_DEFAULT_PERMISSIONS } = require('../config/constants');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // Never returned in queries
    },
    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.SUPERVISOR,
    },
    permissions: {
      type: [String],
      default: function () {
        return ROLE_DEFAULT_PERMISSIONS[this.role] || [];
      },
    },
    // Restrict specific features (admin can block features per user)
    restrictedFeatures: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    deactivatedAt: { type: Date },
    deactivatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Security fields
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    lastLogin: { type: Date },
    lastLoginIp: { type: String },
    passwordChangedAt: { type: Date },
    passwordResetToken: { type: String },
    passwordResetExpires: { type: Date },

    // Refresh token store (hashed)
    refreshTokenHash: { type: String, select: false },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Soft delete
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.password;
        delete ret.refreshTokenHash;
        delete ret.loginAttempts;
        delete ret.lockUntil;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        return ret;
      },
    },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// email index is already created by unique:true in the schema definition
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ isActive: 1, isDeleted: 1 });

// ─── Virtual: account locked ───────────────────────────────────────────────
userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// ─── Pre-save: hash password ───────────────────────────────────────────────
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  if (!this.isNew) this.passwordChangedAt = new Date();
  next();
});

// ─── Method: compare password ──────────────────────────────────────────────
userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

// ─── Method: increment login attempts (lockout after 5) ───────────────────
userSchema.methods.incLoginAttempts = async function () {
  const MAX_ATTEMPTS = 5;
  const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

  if (this.lockUntil && this.lockUntil < Date.now()) {
    // Reset if lock has expired
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 },
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };
  if (this.loginAttempts + 1 >= MAX_ATTEMPTS) {
    updates.$set = { lockUntil: new Date(Date.now() + LOCK_DURATION_MS) };
  }
  return this.updateOne(updates);
};

// ─── Method: reset login attempts on success ──────────────────────────────
userSchema.methods.resetLoginAttempts = async function (ip) {
  return this.updateOne({
    $set: { loginAttempts: 0, lastLogin: new Date(), lastLoginIp: ip },
    $unset: { lockUntil: 1 },
  });
};

// ─── Method: check if password changed after JWT issued ───────────────────
userSchema.methods.changedPasswordAfter = function (jwtIat) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return jwtIat < changedTimestamp;
  }
  return false;
};

// ─── Method: check if a feature is restricted ─────────────────────────────
userSchema.methods.hasFeatureAccess = function (feature) {
  return !this.restrictedFeatures.includes(feature);
};

module.exports = mongoose.model('User', userSchema);
