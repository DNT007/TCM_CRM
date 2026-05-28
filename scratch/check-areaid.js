/**
 * Xác nhận AreaId trong RawCustomer → FK vào Taxonomy (TaxonomyType=1)
 */
const { connectDB } = require('../db');

async function checkAreaId() {
  const pool = await connectDB();

  // 1. Sample Taxonomy TaxonomyType=1 (tỉnh/thành)
  console.log('\n=== 1. Taxonomy TaxonomyType=1 – top 30 ===');
  const tax = await pool.request().query(`
    SELECT TOP 30 Id, TieuDe, TaxonomyType, TrangThai
    FROM dbo.Taxonomy
    WHERE TaxonomyType = 1
    ORDER BY TieuDe
  `);
  console.table(tax.recordset);

  // 2. JOIN Lead → RawCustomer → Taxonomy theo AreaId
  console.log('\n=== 2. Lead JOIN RawCustomer JOIN Taxonomy(AreaId) – top 20 có AreaId ===');
  const join = await pool.request().query(`
    SELECT TOP 20
      l.Id        AS lead_id,
      rc.Id       AS raw_customer_id,
      rc.AreaId,
      t.TieuDe    AS ten_tinh_thanh,
      t.TaxonomyType,
      rc.DiaChi
    FROM dbo.Lead l
    INNER JOIN dbo.RawCustomer rc ON rc.Id = l.RawCustomerId
    INNER JOIN dbo.Taxonomy t    ON t.Id   = rc.AreaId
    WHERE l.TrangThai = 1
    ORDER BY l.Id DESC
  `);
  console.table(join.recordset);

  // 3. Thống kê: bao nhiêu lead có AreaId vs không có
  console.log('\n=== 3. Thống kê Lead có/không có AreaId (qua RawCustomer) ===');
  const stats = await pool.request().query(`
    SELECT
      COUNT(l.Id)                                        AS tong_lead,
      SUM(CASE WHEN rc.AreaId IS NOT NULL THEN 1 ELSE 0 END) AS co_areaid,
      SUM(CASE WHEN rc.AreaId IS NULL     THEN 1 ELSE 0 END) AS khong_areaid
    FROM dbo.Lead l
    LEFT JOIN dbo.RawCustomer rc ON rc.Id = l.RawCustomerId
    WHERE l.TrangThai = 1
  `);
  console.table(stats.recordset);

  // 4. Lead trực tiếp (không qua RawCustomer) – có cột AreaId riêng không?
  console.log('\n=== 4. Kiểm tra dbo.Lead có cột AreaId không ===');
  const leadAreaCol = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Lead' AND TABLE_SCHEMA = 'dbo'
      AND LOWER(COLUMN_NAME) LIKE '%area%'
  `);
  console.table(leadAreaCol.recordset.length ? leadAreaCol.recordset : [{ result: 'KHÔNG có cột AreaId trong dbo.Lead' }]);

  // 5. Phân bố Lead theo tỉnh/thành (qua AreaId)
  console.log('\n=== 5. Top 15 tỉnh/thành theo số lead (qua RawCustomer.AreaId) ===');
  const dist = await pool.request().query(`
    SELECT
      ISNULL(t.TieuDe, N'Không xác định') AS tinh_thanh,
      COUNT(l.Id) AS tong_lead
    FROM dbo.Lead l
    LEFT JOIN dbo.RawCustomer rc ON rc.Id  = l.RawCustomerId
    LEFT JOIN dbo.Taxonomy t     ON t.Id   = rc.AreaId AND t.TaxonomyType = 1
    WHERE l.TrangThai = 1
    GROUP BY t.TieuDe
    ORDER BY tong_lead DESC
  `);
  console.table(dist.recordset);

  process.exit(0);
}

checkAreaId().catch(err => { console.error(err); process.exit(1); });
