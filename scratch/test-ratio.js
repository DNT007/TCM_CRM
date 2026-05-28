const { getPool, connectDB } = require('../db');
async function run() {
  await connectDB();
  const pool = getPool();
  try {
    const request = pool.request();
    let whereLead = 'WHERE l.TrangThai = 1';
    
    // Group by Day/Week/Month format string
    // SQL Server formats: Day -> yyyy-MM-dd, Week -> yyyy-ww, Month -> yyyy-MM
    // For week, we can use DATEPART(iso_week, date) or similar.
    
    // Let's test ratios by month
    const res = await request.query(`
      SELECT 
        FORMAT(l.NgayTao, 'yyyy-MM') AS period,
        COUNT(l.Id) AS total,
        SUM(CASE WHEN l.TinhTrang = 3 THEN 1 ELSE 0 END) AS qualified,
        SUM(CASE WHEN l.TinhTrang = 4 THEN 1 ELSE 0 END) AS unqualified
      FROM dbo.Lead l
      ${whereLead}
      GROUP BY FORMAT(l.NgayTao, 'yyyy-MM')
      ORDER BY period ASC
    `);
    console.log(res.recordset.slice(0, 5));
  } catch (err) {
    console.error('Error:', err.message);
  }
  process.exit();
}
run();
