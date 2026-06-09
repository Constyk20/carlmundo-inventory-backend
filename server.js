require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const compression  = require('compression');
const rateLimit    = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const cron         = require('node-cron');

const connectDB            = require('./config/db');
const logger               = require('./config/logger');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { checkLowStock }    = require('./utils/notificationUtils');

// ─── Route imports ─────────────────────────────────────────────────────────
const authRoutes         = require('./routes/authRoutes');
const userRoutes         = require('./routes/userRoutes');
const productRoutes      = require('./routes/productRoutes');
const customerRoutes     = require('./routes/customerRoutes');
const expenseRoutes      = require('./routes/expenseRoutes');
const transactionRoutes  = require('./routes/transactionRoutes');
const reportRoutes       = require('./routes/reportRoutes');
const excelRoutes        = require('./routes/excelRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const priceRoutes        = require('./routes/priceRoutes');
const registrationRoutes = require('./routes/registrationRoutes');

// ─── App ───────────────────────────────────────────────────────────────────
const app = express();

// Trust first proxy (nginx, etc.)
app.set('trust proxy', 1);

// ─── Security headers ──────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        scriptSrc:  ["'self'"],
        imgSrc:     ["'self'", 'data:', 'blob:'],
      },
    },
  })
);

// ─── CORS ──────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      // allow requests with no origin (mobile apps, curl, Postman)
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ─── Body / compression / sanitize ────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(mongoSanitize());          // strip $ and . from user input

// ─── HTTP request logging ──────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(
    morgan('combined', {
      stream: { write: (msg) => logger.info(msg.trim()) },
    })
  );
}

// ─── Rate limiting ─────────────────────────────────────────────────────────
app.use(
  '/api',
  rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max:      parseInt(process.env.RATE_LIMIT_MAX)        || 200,
    standardHeaders: true,
    legacyHeaders:   false,
    message: { success: false, message: 'Too many requests. Please try again later.' },
  })
);

// Stricter limiter just for login
app.use(
  '/api/auth/login',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max:      parseInt(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
    standardHeaders: true,
    legacyHeaders:   false,
    skipSuccessfulRequests: true,
    message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
  })
);

// ─── Health check (no auth, no rate limit) ─────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({
    status:      'ok',
    timestamp:   new Date().toISOString(),
    uptime:      process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  })
);

// ─── API routes ────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/products',      productRoutes);
app.use('/api/customers',     customerRoutes);
app.use('/api/expenses',      expenseRoutes);
app.use('/api/transactions',  transactionRoutes);
app.use('/api/reports',       reportRoutes);
app.use('/api/excel',         excelRoutes);
app.use('/api/notifications',          notificationRoutes);
app.use('/api/prices',                 priceRoutes);
app.use('/api/registration-requests',  registrationRoutes);

// ─── 404 → error handler ───────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Scheduled jobs ────────────────────────────────────────────────────────
// Low-stock check every 6 hours
cron.schedule('0 */6 * * *', async () => {
  logger.info('⏱  Scheduled: low-stock check');
  await checkLowStock();
});

// ─── Bootstrap ────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 5000;

const startServer = async () => {
  await connectDB();

  const server = app.listen(PORT, () =>
    logger.info(`🚀 Server running [${process.env.NODE_ENV || 'development'}] on port ${PORT}`)
  );

  // ── Graceful shutdown ──────────────────────────────────────────────────
  const shutdown = (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    // Force-kill if connections don't drain in 10 s
    setTimeout(() => {
      logger.error('Forced exit after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', reason);
    shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
    shutdown('uncaughtException');
  });
};

startServer();

module.exports = app; // for testing