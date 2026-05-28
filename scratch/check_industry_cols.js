/**
 * Kiểm tra schema cho "Số lead theo ngành hàng / nhóm khách hàng"
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

  console.log('\n========== [1] Columns của dbo.Lead liên quan industry/classify ==========');
  const leadCols = await req().query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Lead'
      AND (
        LOWER(COLUMN_NAME) LIKE '%industry%'
        OR LOWER(COLUMN_NAME) LIKE '%nganh%'
        OR LOWER(COLUMN_NAME) LIKE '%classify%'
        OR LOWER(COLUMN_NAME) LIKE '%phan%loai%'
        OR LOWER(COLUMN_NAME) LIKE '%nhom%'
        OR LOWER(COLUMN_NAME) LIKE '%loai%'
        OR LOWER(COLUMN_NAME) LIKE '%group%'
        OR LOWER(COLUMN_NAME) LIKE '%partner%'
        OR LOWER(COLUMN_NAME) LIKE '%contact%'
        OR LOWER(COLUMN_NAME) LIKE '%rawcustomer%'
        OR LOWER(COLUMN_NAME) LIKE '%customer%'
        OR LOWER(COLUMN_NAME) LIKE '%taxonomy%'
      )
    ORDER BY COLUMN_NAME
  `);
  console.table(leadCols.recordset);

  console.log('\n========== [2] TẤT CẢ columns của dbo.Lead ==========');
  const allLeadCols = await req().query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Lead'
    ORDER BY ORDINAL_POSITION
  `);
  console.table(allLeadCols.recordset);

  console.log('\n========== [3] Columns của dbo.Customer liên quan classify/industry ==========');
  const custCols = await req().query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Customer'
      AND (
        LOWER(COLUMN_NAME) LIKE '%classify%'
        OR LOWER(COLUMN_NAME) LIKE '%industry%'
        OR LOWER(COLUMN_NAME) LIKE '%nganh%'
        OR LOWER(COLUMN_NAME) LIKE '%nhom%'
        OR LOWER(COLUMN_NAME) LIKE '%loai%'
        OR LOWER(COLUMN_NAME) LIKE '%group%'
      )
    ORDER BY COLUMN_NAME
  `);
  console.table(custCols.recordset);

  console.log('\n========== [4] Taxonomy với TaxonomyType = 7 (ngành hàng?) ==========');
  const tax7 = await req().query(`
    SELECT TOP 20 Id, TieuDe, TaxonomyType, TrangThai
    FROM dbo.Taxonomy
    WHERE TaxonomyType = 7
    ORDER BY Id
  `);
  console.table(tax7.recordset);

  console.log('\n========== [5] Tất cả TaxonomyType distinct ==========');
  const taxTypes = await req().query(`
    SELECT TaxonomyType, COUNT(*) AS so_luong
    FROM dbo.Taxonomy
    GROUP BY TaxonomyType
    ORDER BY TaxonomyType
  `);
  console.table(taxTypes.recordset);

  console.log('\n========== [6] Sample 5 rows dbo.Lead - các cột FK ==========');
  const sample = await req().query(`
    SELECT TOP 5
      Id, SourceId, TinhTrang, NguoiXuLyId,
      PartnerId, ContactId, RawCustomerId
    FROM dbo.Lead
    WHERE TrangThai = 1
    ORDER BY Id DESC
  `);
  console.table(sample.recordset);

  console.log('\n========== [7] ClassifyType phân bố trong dbo.Customer ==========');
  const classify = await req().query(`
    SELECT ClassifyType, COUNT(*) AS so_luong
    FROM dbo.Customer
    GROUP BY ClassifyType
    ORDER BY ClassifyType
  `);
  console.table(classify.recordset);

  await pool.close();
}

run().catch(err => {
  console.error('❌ Lỗi:', err.message);
  process.exit(1);
});
