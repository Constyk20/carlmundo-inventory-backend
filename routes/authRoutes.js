// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { login, register, logout, refreshToken, changePassword, getMe } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validate');

router.post('/login', validate(schemas.login), login);
router.post('/refresh-token', validate(schemas.refreshToken), refreshToken);
router.post('/register', protect, adminOnly, validate(schemas.register), register);
router.post('/logout', protect, logout);
router.put('/change-password', protect, validate(schemas.changePassword), changePassword);
router.get('/me', protect, getMe);

module.exports = router;
