const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      permissions: user.permissions,
      restrictedFeatures: user.restrictedFeatures,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
};

const generateRefreshToken = () => {
  return crypto.randomBytes(64).toString('hex');
};

const hashToken = async (token) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(token, salt);
};

const verifyRefreshToken = async (token, hash) => {
  return bcrypt.compare(token, hash);
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  verifyRefreshToken,
};
