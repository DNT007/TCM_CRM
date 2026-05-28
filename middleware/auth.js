const { getPool, sql } = require('../db');

/**
 * Middleware xác thực API Key
 * Kiểm tra header: x-api-key hoặc query param: ?api_key=
 */
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  const validKey = process.env.API_KEY;

  if (!validKey) {
    // Nếu chưa cấu hình key thì cảnh báo nhưng vẫn cho qua (dev mode)
    console.warn('⚠️  API_KEY chưa được cấu hình trong .env!');
    return next();
  }

  if (!key || key !== validKey) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: API key không hợp lệ hoặc thiếu. Thêm header "x-api-key" hoặc query "?api_key="',
    });
  }

  next();
}

module.exports = { requireApiKey };
