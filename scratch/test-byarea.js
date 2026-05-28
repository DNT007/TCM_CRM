/**
 * Test nhanh query by-area mới (AreaId → Taxonomy)
 */
const { connectDB } = require('../db');

async function test() {
  const pool = await connectDB();
  const start = Date.now();
  
  const r = await pool.request().query(`
    SELECT
      ISNULL(t.TieuDe, N'Không xác định') AS tinh_thanh,
      t.Id                                  AS area_id,
      COUNT(l.Id)                           AS tong_lead
    FROM dbo.Lead l
    LEFT JOIN dbo.RawCustomer rc ON rc.Id = l.RawCustomerId
    LEFT JOIN dbo.Taxonomy t     ON t.Id  = rc.AreaId AND t.TaxonomyType = 1
    WHERE l.TrangThai = 1
    GROUP BY t.TieuDe, t.Id
    ORDER BY tong_lead DESC
  `);
  
  console.log(`Query time: ${Date.now() - start}ms`);
  console.log(`Rows: ${r.recordset.length}`);
  console.table(r.recordset.slice(0, 15));
  process.exit(0);
}

test().catch(err => { console.error(err.message); process.exit(1); });
