require('dotenv').config();
const { sql, connectDB } = require('./config/database');

async function check() {
  const pool = await connectDB();
  const res = await pool.request().query('SELECT DISTINCT TinhTrang FROM dbo.Lead');
  console.log(res.recordset);
  process.exit(0);
}
check();
