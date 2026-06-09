const Product = require('../models/Product');
const Notification = require('../models/Notification');
const User = require('../models/User');
const logger = require('../config/logger');
const { ROLES } = require('../config/constants');

const checkLowStock = async () => {
  try {
    const lowStockProducts = await Product.find({
      isDeleted: false,
      isActive: true,
      $expr: { $lte: ['$currentStock', '$lowStockThreshold'] },
    }).select('name sku currentStock lowStockThreshold category');

    if (lowStockProducts.length === 0) return;

    // Find managers and admins to notify
    const managers = await User.find({
      role: { $in: [ROLES.ADMIN, ROLES.MANAGER, ROLES.PRODUCTION_MANAGER] },
      isActive: true,
    }).select('_id');

    const managerIds = managers.map((m) => m._id);

    const outOfStock = lowStockProducts.filter((p) => p.currentStock === 0);
    const lowStock = lowStockProducts.filter((p) => p.currentStock > 0);

    if (outOfStock.length > 0) {
      await Notification.create({
        title: `⚠️ ${outOfStock.length} Product(s) Out of Stock`,
        message: `The following products are completely out of stock: ${outOfStock.map((p) => p.name).join(', ')}`,
        type: 'low_stock',
        recipients: managerIds,
        relatedEntity: 'Product',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      });
    }

    if (lowStock.length > 0) {
      await Notification.create({
        title: `📦 ${lowStock.length} Product(s) Running Low`,
        message: `Low stock alert: ${lowStock.map((p) => `${p.name} (${p.currentStock} left)`).join(', ')}`,
        type: 'low_stock',
        recipients: managerIds,
        relatedEntity: 'Product',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day
      });
    }

    logger.info(`Low stock check: ${outOfStock.length} out of stock, ${lowStock.length} low stock.`);
  } catch (err) {
    logger.error('Low stock check failed:', err);
  }
};

module.exports = { checkLowStock };
