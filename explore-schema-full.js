const { connectDB, getPool } = require('./db');

async function main() {
  await connectDB();
  const pool = getPool();

  const result = await pool.request().query(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME IN ('Order', 'Lead', 'Customer', 'Opportunity', 'Quotation', 'Activity', 'LinkOpportunityProduct', 'LinkQuotationProduct', 'HistoryQuotation', 'Taxonomy', 'TreeTaxonomy')
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);

  const schema = {};
  for (const row of result.recordset) {
    if (!schema[row.TABLE_NAME]) schema[row.TABLE_NAME] = [];
    schema[row.TABLE_NAME].push(`${row.COLUMN_NAME} (${row.DATA_TYPE})`);
  }

  console.log(JSON.stringify(schema, null, 2));
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
