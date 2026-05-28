const { connectDB } = require('../db');

async function checkFK() {
  try {
    const pool = await connectDB();
    const tables = await pool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE' 
      AND (TABLE_NAME LIKE '%Status%' OR TABLE_NAME LIKE '%TinhTrang%' OR TABLE_NAME LIKE '%Lead%')
    `);
    
    console.log('Tables matching Status or TinhTrang or Lead:');
    console.dir(tables.recordset, { depth: null });
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkFK();
