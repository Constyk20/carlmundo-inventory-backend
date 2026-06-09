const express = require('express');
const router = express.Router();
const {
  getNotifications, markAsRead, markAllAsRead,
  createNotification, deleteNotification,
} = require('../controllers/notificationController');
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/rbac');

router.use(protect);

router.get('/',              getNotifications);
router.post('/',             adminOnly, createNotification);
router.put('/mark-all-read', markAllAsRead);
router.put('/:id/read',      markAsRead);
router.delete('/:id',        adminOnly, deleteNotification);

module.exports = router;
