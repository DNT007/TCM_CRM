const { connectDB, getPool } = require('./db');

async function check() {
  await connectDB();
  const pool = getPool();

  // 1. Phân bổ TinhTrang thực tế
  const r1 = await pool.request().query(
    'SELECT TinhTrang, COUNT(*) AS so_luong FROM dbo.Lead WHERE TrangThai = 1 GROUP BY TinhTrang ORDER BY TinhTrang'
  );
  console.log('\n=== Phân bổ TinhTrang trong dbo.Lead ===');
  console.table(r1.recordset);

  // 2. Danh sách cột bảng Lead
  const r2 = await pool.request().query(
    "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Lead' AND TABLE_SCHEMA = 'dbo' ORDER BY ORDINAL_POSITION"
  );
  console.log('\n=== Các cột trong dbo.Lead ===');
  console.table(r2.recordset);
}

check().catch(console.error).finally(() => process.exit());
