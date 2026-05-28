const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi    = require('swagger-ui-express');

const PORT = process.env.PORT || 3005;

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
    servers: [
      { url: `http://localhost:${PORT}`, description: 'Local Server' },
    ],
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
