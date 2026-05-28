/**
 * Kiểm tra IndustrialParkId, CustomerType, PartnerType và Taxonomy liên quan
 */
require('dotenv').config();
const sql = require('mssql/msnodesqlv8');

const connectionString = [
  `Driver={ODBC Driver 17 for SQL Server}`,
  `Server=${process.env.DB_SERVER || '(local)'}`,
  `Database=${process.env.DB_NAME || 'TCT_CRM'}`,
  `Uid=${process.env.DB_USER || 'sa'}`,
  `Pwd=${process.env.DB_PASSWORD || ''}`,
].join(';') + ';';

async function run() {
  const pool = await sql.connect({ connectionString });
  const req = () => pool.request();

  console.log('\n===== [A] Lead JOIN RawCustomer - IndustrialParkId, CustomerType, PartnerType =====');
  const joined = await req().query(`
    SELECT TOP 10
      l.Id          AS lead_id,
      l.RawCustomerId,
      rc.IndustrialParkId,
      rc.CustomerType,
      rc.PartnerType,
      rc.AreaId
    FROM dbo.Lead l
    LEFT JOIN dbo.RawCustomer rc ON rc.Id = l.RawCustomerId
    WHERE l.TrangThai = 1
    ORDER BY l.Id DESC
  `);
  console.table(joined.recordset);

  console.log('\n===== [B] Taxonomy TaxonomyType=2 (CustomerType / PartnerType?) =====');
  const tax2 = await req().query(`
    SELECT TOP 30 Id, TieuDe, TaxonomyType, ParentId, TrangThai
    FROM dbo.Taxonomy
    WHERE TaxonomyType = 2
    ORDER BY Id
  `);
  console.table(tax2.recordset);

  console.log('\n===== [C] Taxonomy TaxonomyType=4 (PartnerType?) =====');
  const tax4 = await req().query(`
    SELECT TOP 20 Id, TieuDe, TaxonomyType, ParentId, TrangThai
    FROM dbo.Taxonomy
    WHERE TaxonomyType = 4
    ORDER BY Id
  `);
  console.table(tax4.recordset);

  console.log('\n===== [D] CustomerType phân bố trong RawCustomer =====');
  const custType = await req().query(`
    SELECT CustomerType, COUNT(*) AS so_luong
    FROM dbo.RawCustomer
    GROUP BY CustomerType
    ORDER BY CustomerType
  `);
  console.table(custType.recordset);

  console.log('\n===== [E] PartnerType phân bố trong RawCustomer =====');
  const partType = await req().query(`
    SELECT PartnerType, COUNT(*) AS so_luong
    FROM dbo.RawCustomer
    GROUP BY PartnerType
    ORDER BY PartnerType
  `);
  console.table(partType.recordset);

  console.log('\n===== [F] IndustrialParkId -> Taxonomy TaxonomyType=? =====');
  // Tìm IndustrialParkId dùng TaxonomyType nào
  const industrialLink = await req().query(`
    SELECT DISTINCT
      t.TaxonomyType,
      t.Id,
      t.TieuDe
    FROM dbo.RawCustomer rc
    INNER JOIN dbo.Taxonomy t ON t.Id = rc.IndustrialParkId
    WHERE rc.IndustrialParkId IS NOT NULL
    ORDER BY t.TaxonomyType, t.Id
  `);
  console.table(industrialLink.recordset);

  console.log('\n===== [G] Lead JOIN RawCustomer -> Taxonomy (type 6 = ngành nghề?) =====');
  const tax6check = await req().query(`
    SELECT TOP 15 Id, TieuDe, TaxonomyType, ParentId
    FROM dbo.Taxonomy
    WHERE TaxonomyType = 6
    ORDER BY Id
  `);
  console.table(tax6check.recordset);

  console.log('\n===== [H] Số lead có dữ liệu vs null IndustrialParkId =====');
  const nullCheck = await req().query(`
    SELECT
      SUM(CASE WHEN rc.IndustrialParkId IS NOT NULL THEN 1 ELSE 0 END) AS co_industrial,
      SUM(CASE WHEN rc.IndustrialParkId IS NULL     THEN 1 ELSE 0 END) AS khong_co_industrial,
      SUM(CASE WHEN rc.CustomerType > 0             THEN 1 ELSE 0 END) AS co_customer_type,
      COUNT(*) AS tong
    FROM dbo.Lead l
    LEFT JOIN dbo.RawCustomer rc ON rc.Id = l.RawCustomerId
    WHERE l.TrangThai = 1
  `);
  console.table(nullCheck.recordset);

  await pool.close();
}

run().catch(err => {
  console.error('❌ Lỗi:', err.message);
  process.exit(1);
});
