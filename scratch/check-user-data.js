const { connectDB, getPool, sql } = require('../db');

async function main() {
  await connectDB();
  const pool = getPool();

  const result = await pool.request().query(`
    SELECT TOP 5 * FROM dbo.UserFunction
  `);

  console.log(JSON.stringify(result.recordset, null, 2));
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
