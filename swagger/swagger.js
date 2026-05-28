const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi    = require('swagger-ui-express');
const os           = require('os');

/**
 * Lấy IP LAN của máy host (bỏ qua loopback và IPv6)
 */
function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const PORT        = process.env.PORT        || 3005;
const LAN_IP      = getLanIp();
// Nếu deploy production, set biến này trong .env để Swagger gọi đúng HTTPS
// Ví dụ: API_BASE_URL=https://api.tecotec.vn
const API_BASE_URL = process.env.API_BASE_URL || null;

/**
 * Xây danh sách servers cho Swagger UI.
 * - Nếu có API_BASE_URL trong .env → đưa lên đầu (dùng khi production HTTPS)
 * - Luôn giữ LAN IP và localhost phía sau để dev local vẫn dùng được
 */
function buildServers() {
  const list = [];
  if (API_BASE_URL) {
    list.push({ url: API_BASE_URL, description: 'Production Server' });
  }
  list.push({ url: `http://${LAN_IP}:${PORT}`, description: `LAN Server (${LAN_IP})` });
  list.push({ url: `http://localhost:${PORT}`,  description: 'Local (chỉ dùng trên máy host)' });
  return list;
}

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'TCT_CRM API',
      version: '1.0.0',
      description: `
## REST API cho hệ thống TCT_CRM

Cung cấp dữ liệu CRM cho Google Data Studio / Looker Studio và các reporting tool.

### Authentication
Tất cả endpoint cần API Key. Truyền theo một trong hai cách:
- **Header**: \`x-api-key: <your_key>\`
- **Query param**: \`?api_key=<your_key>\`

### Rate Limiting
Hiện tại chưa áp dụng rate limit.
      `,
      contact: {
        name: 'TCT Dev Team',
      },
    },
    servers: buildServers(),
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'API Key để xác thực. Lấy từ file .env (API_KEY)',
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
  },
  apis: ['./routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = { swaggerUi, swaggerSpec };

