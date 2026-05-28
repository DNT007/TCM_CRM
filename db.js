const sql = require('mssql/msnodesqlv8');
require('dotenv').config();

const connectionString = [
  `Driver={ODBC Driver 17 for SQL Server}`,
  `Server=${process.env.DB_SERVER || '(local)'}`,
  `Database=${process.env.DB_NAME || 'TCT_CRM'}`,
  `Uid=${process.env.DB_USER || 'sa'}`,
  `Pwd=${process.env.DB_PASSWORD || ''}`,
].join(';') + ';';

const config = {
  connectionString,
  requestTimeout: 60000,  // 60 giây (default mssql chỉ 15s)
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool = null;

/**
 * Khởi tạo connection pool qua ODBC (named pipe / shared memory)
 */
async function connectDB() {
  try {
    if (pool && pool.connected) {
      return pool;
    }
    pool = await sql.connect(config);
    console.log(`✅ Kết nối SQL Server thành công: ${process.env.DB_SERVER || '(local)'} | DB: ${process.env.DB_NAME || 'TCT_CRM'}`);
    return pool;
  } catch (err) {
    console.error('❌ Lỗi kết nối SQL Server:', err.message);
    throw err;
  }
}

/**
 * Lấy pool hiện tại
 */
function getPool() {
  if (!pool || !pool.connected) {
    throw new Error('Database chưa được kết nối. Gọi connectDB() trước.');
  }
  return pool;
}

/**
 * Đóng kết nối khi shutdown
 */
async function closeDB() {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('🔌 Đã đóng kết nối SQL Server');
  }
}

module.exports = { sql, connectDB, getPool, closeDB };
