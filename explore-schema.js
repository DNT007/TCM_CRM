const { connectDB, getPool, sql } = require('./db');

async function main() {
  await connectDB();
  const pool = getPool();

  const result = await pool.request().query(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME IN ('Order','Lead','Product','Customer','Opportunity','Quotation','Activity')
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);

  // Group by table
  const schema = {};
  for (const row of result.recordset) {
    if (!schema[row.TABLE_NAME]) schema[row.TABLE_NAME] = [];
    schema[row.TABLE_NAME].push({
      column: row.COLUMN_NAME,
      type: row.DATA_TYPE,
      nullable: row.IS_NULLABLE,
      maxLen: row.CHARACTER_MAXIMUM_LENGTH
    });
  }

  console.log(JSON.stringify(schema, null, 2));
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
