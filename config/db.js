const mongoose = require('mongoose');
const logger = require('./logger');

const connectDB = async () => {
  const options = {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    minPoolSize: 2,
  };

  const connect = async () => {
    try {
      const conn = await mongoose.connect(process.env.MONGO_URI, options);
      logger.info(`MongoDB Connected: ${conn.connections[0].host}`)
    } catch (err) {
      logger.error('MongoDB Connection Error:', err);
      logger.info('Retrying in 5 seconds...');
      setTimeout(connect, 5000);
    }
  };

  await connect();

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected. Attempting reconnect...');
    setTimeout(connect, 5000);
  });

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB error:', err);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed on app termination');
    process.exit(0);
  });
};

module.exports = connectDB;
