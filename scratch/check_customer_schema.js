const { connectDB, getPool } = require('../db');

async function main() {
  await connectDB();
  const pool = getPool();

  // Xác nhận Quotation có PartnerId -> Customer
  const q = await pool.request().query(`
    SELECT TOP 5
      q.Id, q.PartnerId, q.TongGiaTri, q.TrangThai, q.NgayTao,
      c.TenKhachHang, c.NgayTao AS kh_ngay_tao
    FROM dbo.Quotation q
    LEFT JOIN dbo.Customer c ON c.Id = q.PartnerId
    WHERE q.TrangThai != 0
  `);
  console.log('=== Quotation -> Customer (via PartnerId) ===');
  console.log(JSON.stringify(q.recordset, null, 2));

  // Kiểm tra Order -> Quotation -> Customer chain
  const chain = await pool.request().query(`
    SELECT TOP 5
      o.Id AS order_id,
      q.Id AS quotation_id,
      q.PartnerId AS customer_id,
      q.TongGiaTri,
      c.TenKhachHang,
      c.NgayTao AS kh_ngay_tao,
      q.NgayTao AS quotation_ngay_tao
    FROM dbo.[Order] o
    INNER JOIN dbo.Quotation q ON q.Id = o.Id
    LEFT  JOIN dbo.Customer  c ON c.Id = q.PartnerId
    WHERE o.TrangThai = 1
  `);
  console.log('\n=== Order -> Quotation -> Customer ===');
  console.log(JSON.stringify(chain.recordset, null, 2));

  // Đếm Order có CustomerId (via Quotation)
  const cnt = await pool.request().query(`
    SELECT COUNT(*) AS total_orders
    FROM dbo.[Order] o
    INNER JOIN dbo.Quotation q ON q.Id = o.Id
    WHERE o.TrangThai = 1 AND q.PartnerId IS NOT NULL
  `);
  console.log('\n=== Orders có CustomerId (via Quotation) ===');
  console.log(JSON.stringify(cnt.recordset[0]));

  // ClassifyType map
  const clMap = await pool.request().query(`
    SELECT ClassifyType, CustomerType, COUNT(*) AS cnt
    FROM dbo.Customer WHERE TrangThai = 1
    GROUP BY ClassifyType, CustomerType ORDER BY ClassifyType, CustomerType
  `);
  console.log('\n=== CUSTOMER ClassifyType x CustomerType ===');
  clMap.recordset.forEach(r => console.log(` ClassifyType=${r.ClassifyType}, CustomerType=${r.CustomerType}: ${r.cnt} KH`));

  // Taxonomy type 7 (nhóm sản phẩm) xem có phải ngành không
  const t7 = await pool.request().query(`
    SELECT TOP 10 Id, TieuDe, KhoaChaId FROM dbo.Taxonomy WHERE TaxonomyType = 7 ORDER BY KhoaChaId, ThuTuSapXep
  `);
  console.log('\n=== TAXONOMY TYPE 7 (nhóm SP) ===');
  t7.recordset.forEach(r => console.log(` Id=${r.Id}, Cha=${r.KhoaChaId}, TieuDe=${r.TieuDe}`));

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
