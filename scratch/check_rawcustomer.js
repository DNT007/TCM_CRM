/**
 * Kiểm tra RawCustomer columns và link sang Taxonomy type 7
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

  console.log('\n===== [A] Tất cả columns của dbo.RawCustomer =====');
  const rawCols = await req().query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RawCustomer'
    ORDER BY ORDINAL_POSITION
  `);
  console.table(rawCols.recordset);

  console.log('\n===== [B] Tất cả columns của dbo.Customer =====');
  const custCols = await req().query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Customer'
    ORDER BY ORDINAL_POSITION
  `);
  console.table(custCols.recordset);

  console.log('\n===== [C] RawCustomer sample + ngành hàng liên quan =====');
  const sample = await req().query(`
    SELECT TOP 5
      rc.Id, rc.HoTen, rc.AreaId,
      rc.IndustryId,
      rc.NhomKhachHangId,
      rc.NganhHangId
    FROM dbo.RawCustomer rc
  `);
  console.table(sample.recordset);

  console.log('\n===== [D] Lead JOIN RawCustomer - kiểm tra IndustryId / NganhHangId =====');
  const joined = await req().query(`
    SELECT TOP 5
      l.Id AS lead_id,
      l.RawCustomerId,
      rc.IndustryId,
      rc.NganhHangId,
      rc.NhomKhachHangId,
      rc.AreaId
    FROM dbo.Lead l
    LEFT JOIN dbo.RawCustomer rc ON rc.Id = l.RawCustomerId
    WHERE l.TrangThai = 1
    ORDER BY l.Id DESC
  `);
  console.table(joined.recordset);

  console.log('\n===== [E] Taxonomy TaxonomyType=6 (ngành nghề khách hàng?) =====');
  const tax6 = await req().query(`
    SELECT TOP 20 Id, TieuDe, TaxonomyType, ParentId
    FROM dbo.Taxonomy
    WHERE TaxonomyType = 6
    ORDER BY Id
  `);
  console.table(tax6.recordset);

  await pool.close();
}

run().catch(err => {
  console.error('❌ Lỗi:', err.message);
  process.exit(1);
});
