const { connectDB, getPool } = require('./db');

async function run() {
  await connectDB();
  const result = await getPool().request().query(`
    SELECT TABLE_NAME 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_SCHEMA = 'dbo' 
    ORDER BY TABLE_NAME
  `);
  console.log(result.recordset.map(r => r.TABLE_NAME).join(', '));
  process.exit(0);
}
run();
