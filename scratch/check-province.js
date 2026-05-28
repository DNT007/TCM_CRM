/**
 * Kiểm tra: Tỉnh/Thành phố trong CRM được lưu ở đâu trong DB?
 * - Tìm cột liên quan đến tỉnh/thành phố trong dbo.Lead, dbo.RawCustomer, dbo.Customer
 * - Kiểm tra TaxonomyType=1 có phải là tỉnh/thành không
 * - Xem thử 5 row mẫu có data thực tế
 */
const { connectDB } = require('../db');

async function checkProvince() {
  const pool = await connectDB();

  // 1. Kiểm tra TaxonomyType=1 có nội dung gì
  console.log('\n=== 1. Taxonomy với TaxonomyType=1 (top 20) ===');
  const tax1 = await pool.request().query(`
    SELECT TOP 20 Id, TieuDe, TaxonomyType, TrangThai
    FROM dbo.Taxonomy
    WHERE TaxonomyType = 1
    ORDER BY Id
  `);
  console.table(tax1.recordset);

  // 2. Các cột trong dbo.Lead liên quan đến địa chỉ / tỉnh thành
  console.log('\n=== 2. Tất cả cột dbo.Lead (xem cột nào liên quan địa chỉ) ===');
  const leadCols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Lead' AND TABLE_SCHEMA = 'dbo'
    ORDER BY ORDINAL_POSITION
  `);
  console.table(leadCols.recordset);

  // 3. Các cột trong dbo.RawCustomer liên quan địa chỉ / tỉnh
  console.log('\n=== 3. Tất cả cột dbo.RawCustomer (xem cột nào liên quan địa chỉ) ===');
  const rcCols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'RawCustomer' AND TABLE_SCHEMA = 'dbo'
    ORDER BY ORDINAL_POSITION
  `);
  console.table(rcCols.recordset);

  // 4. Xem 5 row mẫu từ dbo.Lead – chú ý các cột có "City", "Tinh", "Province", "Area", "DiaChi"
  console.log('\n=== 4. Mẫu 5 row dbo.Lead (mọi cột) ===');
  const leadSample = await pool.request().query(`
    SELECT TOP 5 * FROM dbo.Lead WHERE TrangThai = 1 ORDER BY NgayTao DESC
  `);
  console.dir(leadSample.recordset, { depth: null });

  // 5. Xem 5 row mẫu từ dbo.RawCustomer – tìm cột địa chỉ
  console.log('\n=== 5. Mẫu 5 row dbo.RawCustomer (mọi cột) ===');
  const rcSample = await pool.request().query(`
    SELECT TOP 5 * FROM dbo.RawCustomer ORDER BY Id DESC
  `);
  console.dir(rcSample.recordset, { depth: null });

  // 6. Kiểm tra bảng nào trong DB có cột tên chứa "tinh" hoặc "province" hoặc "city"
  console.log('\n=== 6. Cột nào trong DB có tên chứa "tinh", "province", "city", "area" ===');
  const colSearch = await pool.request().query(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND (
        LOWER(COLUMN_NAME) LIKE '%tinh%'
        OR LOWER(COLUMN_NAME) LIKE '%province%'
        OR LOWER(COLUMN_NAME) LIKE '%city%'
        OR LOWER(COLUMN_NAME) LIKE '%area%'
        OR LOWER(COLUMN_NAME) LIKE '%region%'
        OR LOWER(COLUMN_NAME) LIKE '%diachingan%'
      )
    ORDER BY TABLE_NAME, COLUMN_NAME
  `);
  console.table(colSearch.recordset);

  // 7. Kiểm tra cột CityId, ProvinceId, AreaId trong dbo.Lead nếu có
  console.log('\n=== 7. Kiểm tra cột FK liên quan Taxonomy trong dbo.Lead ===');
  const fkCheck = await pool.request().query(`
    SELECT c.COLUMN_NAME, c.DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS c
    WHERE c.TABLE_NAME = 'Lead' AND c.TABLE_SCHEMA = 'dbo'
      AND (
        LOWER(c.COLUMN_NAME) LIKE '%id'
        OR LOWER(c.COLUMN_NAME) LIKE '%type'
      )
    ORDER BY c.ORDINAL_POSITION
  `);
  console.table(fkCheck.recordset);

  process.exit(0);
}

checkProvince().catch(err => { console.error(err); process.exit(1); });
