require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { connectDB, closeDB } = require('./db');
const { requireApiKey } = require('./middleware/auth');
const { swaggerUi, swaggerSpec } = require('./swagger/swagger');

// ─── Import routes ─────────────────────────────────
const customersRouter     = require('./routes/customers');
const ordersRouter        = require('./routes/orders');
const leadsRouter         = require('./routes/leads');
const productsRouter      = require('./routes/products');
const reportsRouter       = require('./routes/reports');
const opportunitiesRouter = require('./routes/opportunity');
const quotationsRouter    = require('./routes/quotation');
const conversionRouter    = require('./routes/conversion');

const app  = express();
const PORT = process.env.PORT || 3005;

// ─── Middleware ─────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Swagger UI tại "/" (không cần auth) ──────────
app.use('/', swaggerUi.serve);
app.get('/', swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { background-color: #1a3a5c; }',
  customSiteTitle: 'TCT_CRM API Docs',
}));

// Redirect /api-docs về /
app.get('/api-docs', (req, res) => {
  res.redirect('/');
});

// Endpoint trả raw OpenAPI JSON (dùng để import vào Postman)
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(swaggerSpec);
});

// ─── Health check (không cần auth) ─────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: process.env.DB_NAME || 'TCT_CRM',
    version: '1.0.0',
  });
});

// ─── API Routes (yêu cầu auth) ─────────────────────
app.use('/api', requireApiKey);
app.use('/api/customers',     customersRouter);
app.use('/api/orders',        ordersRouter);
app.use('/api/leads',         leadsRouter);
app.use('/api/products',      productsRouter);
app.use('/api/reports',       reportsRouter);
app.use('/api/opportunities', opportunitiesRouter);
app.use('/api/quotations',    quotationsRouter);
app.use('/api/conversion',    conversionRouter);

// ─── 404 handler ───────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route không tồn tại: ${req.method} ${req.originalUrl}`,
    hint: 'Xem tất cả endpoint tại /api-docs',
  });
});

// ─── Global error handler ──────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Lỗi server nội bộ' });
});

// ─── Khởi động server ──────────────────────────────
async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log('');
      console.log('🚀 TCT_CRM API Server đang chạy!');
      console.log(`   Local:   http://localhost:${PORT}`);
      console.log(`   Docs:    http://localhost:${PORT}/`);
      console.log(`   Health:  http://localhost:${PORT}/health`);
      console.log('');
      console.log('📌 Endpoints:');
      console.log(`   GET  /api/customers`);
      console.log(`   GET  /api/orders`);
      console.log(`   GET  /api/orders/stats/by-time`);
      console.log(`   GET  /api/orders/stats/revenue-by-time`);
      console.log(`   GET  /api/orders/stats/revenue-by-sales-rep`);
      console.log(`   GET  /api/orders/stats/revenue-by-product`);
      console.log(`   GET  /api/orders/stats/revenue-by-area`);
      console.log(`   GET  /api/orders/stats/revenue-by-customer-group`);
      console.log(`   GET  /api/orders/stats/avg-deal-size`);
      console.log(`   GET  /api/orders/stats/quotation-to-order-time`);
      console.log(`   GET  /api/leads`);
      console.log(`   GET  /api/products`);
      console.log(`   GET  /api/reports/revenue`);
      console.log(`   GET  /api/reports/orders-summary`);
      console.log(`   GET  /api/reports/customers-summary`);
      console.log(`   GET  /api/reports/leads-funnel`);
      console.log(`   GET  /api/opportunities/stats/by-time`);
      console.log(`   GET  /api/opportunities/stats/by-sales-rep`);
      console.log(`   GET  /api/quotations/stats/by-time`);
      console.log(`   GET  /api/quotations/stats/by-sales-rep`);
      console.log(`   GET  /api/quotations/stats/win-loss-rate`);
      console.log(`   GET  /api/conversion/lead-to-opportunity`);
      console.log(`   GET  /api/conversion/opportunity-to-quotation`);
      console.log(`   GET  /api/conversion/quotation-to-order`);
      console.log(`   GET  /api/conversion/lead-to-order`);
      console.log(`   GET  /api/conversion/win-rate-by-sales-rep`);
      console.log(`   GET  /api/conversion/win-rate-by-product`);
      console.log('');
    });
  } catch (err) {
    console.error('❌ Không thể khởi động server:', err.message);
    process.exit(1);
  }
}

// ─── Graceful shutdown ─────────────────────────────
process.on('SIGINT',  async () => { await closeDB(); process.exit(0); });
process.on('SIGTERM', async () => { await closeDB(); process.exit(0); });

startServer();
