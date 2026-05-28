/**
 * Kiểm tra columns Taxonomy và phân loại type
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

  console.log('\n===== [X] Columns của dbo.Taxonomy =====');
  const taxCols = await req().query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Taxonomy'
    ORDER BY ORDINAL_POSITION
  `);
  console.table(taxCols.recordset);

  console.log('\n===== [Y] Taxonomy TaxonomyType=2 (TOP 20) =====');
  const tax2 = await req().query(`
    SELECT TOP 20 Id, TieuDe, TaxonomyType, TrangThai
    FROM dbo.Taxonomy
    WHERE TaxonomyType = 2
    ORDER BY Id
  `);
  console.table(tax2.recordset);

  console.log('\n===== [Z] CustomerType phân bố trong RawCustomer vs Taxonomy =====');
  const custType = await req().query(`
    SELECT rc.CustomerType, COUNT(*) AS so_luong
    FROM dbo.RawCustomer rc
    GROUP BY rc.CustomerType
    ORDER BY rc.CustomerType
  `);
  console.table(custType.recordset);

  console.log('\n===== [Z2] PartnerType phân bố trong RawCustomer =====');
  const partType = await req().query(`
    SELECT rc.PartnerType, COUNT(*) AS so_luong
    FROM dbo.RawCustomer rc
    GROUP BY rc.PartnerType
    ORDER BY rc.PartnerType
  `);
  console.table(partType.recordset);

  console.log('\n===== [Z3] Lead có CustomerType != 1 hoặc khác nhau? =====');
  const ctypeLead = await req().query(`
    SELECT
      rc.CustomerType,
      rc.PartnerType,
      COUNT(l.Id) AS tong_lead
    FROM dbo.Lead l
    LEFT JOIN dbo.RawCustomer rc ON rc.Id = l.RawCustomerId
    WHERE l.TrangThai = 1
    GROUP BY rc.CustomerType, rc.PartnerType
    ORDER BY tong_lead DESC
  `);
  console.table(ctypeLead.recordset);

  console.log('\n===== [Z4] Lead JOIN dbo.Customer.ClassifyType =====');
  const classifyLead = await req().query(`
    SELECT
      c.ClassifyType,
      CASE c.ClassifyType WHEN 1 THEN N'Doanh nghiệp' WHEN 2 THEN N'Cá nhân' ELSE N'Không rõ' END AS ten_nhom,
      COUNT(l.Id) AS tong_lead
    FROM dbo.Lead l
    LEFT JOIN dbo.Customer c ON c.Id = COALESCE(l.PartnerId, l.ContactId)
    WHERE l.TrangThai = 1
    GROUP BY c.ClassifyType
    ORDER BY tong_lead DESC
  `);
  console.table(classifyLead.recordset);

  await pool.close();
}

run().catch(err => {
  console.error('❌ Lỗi:', err.message);
  process.exit(1);
});
