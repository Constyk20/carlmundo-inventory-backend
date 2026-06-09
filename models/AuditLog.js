const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userEmail: { type: String }, // denormalized for permanence
    action: {
      type: String,
      required: true,
      enum: [
        'create', 'update', 'delete', 'login', 'logout',
        'login_failed', 'deactivate', 'activate', 'role_change',
        'permission_change', 'feature_restrict', 'feature_unrestrict',
        'import', 'export', 'approve', 'reject',
      ],
    },
    entity: { type: String, required: true }, // e.g. 'User', 'Product', 'Expense'
    entityId: { type: mongoose.Schema.Types.ObjectId },
    changes: { type: mongoose.Schema.Types.Mixed }, // before/after diff
    ipAddress: { type: String },
    userAgent: { type: String },
    meta: { type: mongoose.Schema.Types.Mixed }, // extra context
    status: { type: String, enum: ['success', 'failure'], default: 'success' },
  },
  { timestamps: true }
);

auditLogSchema.index({ user: 1 });
auditLogSchema.index({ entity: 1, entityId: 1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
