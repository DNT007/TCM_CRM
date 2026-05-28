// Test kết nối qua msnodesqlv8 với connection string format đúng
const sql = require('mssql/msnodesqlv8');

async function test(label, connStr) {
  const pool = new sql.ConnectionPool({
    connectionString: connStr,
  });
  try {
    await Promise.race([
      pool.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout 8s')), 8000))
    ]);
    const res = await pool.request().query('SELECT DB_NAME() AS db, @@SERVERNAME AS srv');
    console.log(`✅ ${label}: db=${res.recordset[0].db}, server=${res.recordset[0].srv}`);
    await pool.close();
    return true;
  } catch (err) {
    console.log(`❌ ${label}: ${err.message.substring(0,120)}`);
    try { await pool.close(); } catch(_) {}
    return false;
  }
}

async function main() {
  const tests = [
    ['Win Auth (local)', 'Driver={SQL Server Native Client 11.0};Server=(local);Database=TCT_CRM;Trusted_Connection=yes;'],
    ['Win Auth (localhost)', 'Driver={SQL Server Native Client 11.0};Server=localhost;Database=TCT_CRM;Trusted_Connection=yes;'],
    ['SQL Auth (local)', 'Driver={SQL Server Native Client 11.0};Server=(local);Database=TCT_CRM;Uid=sa;Pwd=Dong@123;'],
    ['SQL Auth ODBC17 local', 'Driver={ODBC Driver 17 for SQL Server};Server=(local);Database=TCT_CRM;Uid=sa;Pwd=Dong@123;'],
    ['SQL Auth ODBC17 pipe', 'Driver={ODBC Driver 17 for SQL Server};Server=np:\\\\.\\pipe\\sql\\query;Database=TCT_CRM;Uid=sa;Pwd=Dong@123;'],
    ['SQL Auth NP MSSQLSERVER', 'Driver={ODBC Driver 17 for SQL Server};Server=np:\\\\.\\pipe\\MSSQL$MSSQLSERVER\\sql\\query;Database=TCT_CRM;Uid=sa;Pwd=Dong@123;'],
  ];

  for (const [label, connStr] of tests) {
    const ok = await test(label, connStr);
    if (ok) {
      console.log('\n🎯 Sử dụng connection string này để cấu hình db.js!');
      console.log(connStr);
      break;
    }
  }
  process.exit(0);
}

main();
