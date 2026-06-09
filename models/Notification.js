const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ['low_stock', 'expense_approval', 'payment_due', 'system', 'info', 'warning', 'error'],
      default: 'info',
    },
    recipients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // empty = all
    recipientRoles: [{ type: String }], // broadcast to roles
    isRead: { type: Boolean, default: false },
    readBy: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        readAt: { type: Date, default: Date.now },
      },
    ],
    link: { type: String }, // deep link for mobile
    relatedEntity: { type: String },
    relatedEntityId: { type: mongoose.Schema.Types.ObjectId },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

notificationSchema.index({ recipients: 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL

module.exports = mongoose.model('Notification', notificationSchema);
