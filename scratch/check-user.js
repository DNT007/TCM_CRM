const { connectDB, getPool, sql } = require('../db');

async function main() {
  await connectDB();
  const pool = getPool();

  const result = await pool.request().query(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'UserFunction'
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);

  console.log(JSON.stringify(result.recordset, null, 2));
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
