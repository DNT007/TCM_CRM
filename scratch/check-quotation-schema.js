require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { connectDB, getPool } = require('../db');

connectDB().then(async () => {
  const pool = getPool();

  // Lấy danh sách cột của bảng Quotation
  const r = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Quotation' AND TABLE_SCHEMA = 'dbo'
    ORDER BY ORDINAL_POSITION
  `);

  console.log('=== Columns of dbo.Quotation ===');
  r.recordset.forEach(c => console.log(` - ${c.COLUMN_NAME}  (${c.DATA_TYPE})`));

  process.exit(0);
}).catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
