/**
 * Kiểm tra cột TinhTrang trong dbo.Lead:
 *  1. Kiểu dữ liệu cột
 *  2. Ràng buộc FK (nếu có)
 *  3. Các giá trị thực tế trong DB
 *  4. Nếu có FK → xem bảng đích + nội dung tương ứng
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
  const req  = () => pool.request();

  // ─── 1. Kiểu dữ liệu cột TinhTrang trong dbo.Lead ─────────────────────────
  console.log('\n===== [1] Kiểu dữ liệu cột TinhTrang trong dbo.Lead =====');
  const colType = await req().query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME   = 'Lead'
      AND COLUMN_NAME  = 'TinhTrang'
  `);
  console.table(colType.recordset);

  // ─── 2. Kiểm tra FK constraint trên cột TinhTrang ──────────────────────────
  console.log('\n===== [2] FK constraint trên TinhTrang (nếu có) =====');
  const fkCheck = await req().query(`
    SELECT
      fk.name                        AS fk_name,
      tp.name                        AS parent_table,
      cp.name                        AS parent_column,
      tr.name                        AS ref_table,
      cr.name                        AS ref_column
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
    JOIN sys.tables  tp ON tp.object_id = fkc.parent_object_id
    JOIN sys.columns cp ON cp.object_id = fkc.parent_object_id  AND cp.column_id = fkc.parent_column_id
    JOIN sys.tables  tr ON tr.object_id = fkc.referenced_object_id
    JOIN sys.columns cr ON cr.object_id = fkc.referenced_object_id AND cr.column_id = fkc.referenced_column_id
    WHERE tp.name = 'Lead'
      AND cp.name = 'TinhTrang'
  `);
  if (fkCheck.recordset.length === 0) {
    console.log('  → KHÔNG có FK constraint. TinhTrang là giá trị raw (int/nvarchar).');
  } else {
    console.table(fkCheck.recordset);
  }

  // ─── 3. Tất cả FK trên bảng dbo.Lead (tổng quan) ──────────────────────────
  console.log('\n===== [3] Tất cả FK trên dbo.Lead =====');
  const allFk = await req().query(`
    SELECT
      fk.name        AS fk_name,
      cp.name        AS col_lead,
      tr.name        AS ref_table,
      cr.name        AS ref_col
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
    JOIN sys.tables  tp ON tp.object_id = fkc.parent_object_id
    JOIN sys.columns cp ON cp.object_id = fkc.parent_object_id  AND cp.column_id = fkc.parent_column_id
    JOIN sys.tables  tr ON tr.object_id = fkc.referenced_object_id
    JOIN sys.columns cr ON cr.object_id = fkc.referenced_object_id AND cr.column_id = fkc.referenced_column_id
    WHERE tp.name = 'Lead'
    ORDER BY cp.name
  `);
  if (allFk.recordset.length === 0) {
    console.log('  → dbo.Lead không có FK nào.');
  } else {
    console.table(allFk.recordset);
  }

  // ─── 4. Các giá trị TinhTrang thực tế có trong DB ─────────────────────────
  console.log('\n===== [4] Distinct TinhTrang trong dbo.Lead (kể cả TrangThai=0) =====');
  const distinctVals = await req().query(`
    SELECT
      l.TinhTrang,
      COUNT(*)  AS so_luong
    FROM dbo.Lead l
    GROUP BY l.TinhTrang
    ORDER BY l.TinhTrang
  `);
  console.table(distinctVals.recordset);

  // ─── 5. Thử JOIN Taxonomy — kiểm tra TinhTrang có map vào Taxonomy k ───────
  console.log('\n===== [5] Thử JOIN dbo.Taxonomy ON t.Id = l.TinhTrang =====');
  const joinTax = await req().query(`
    SELECT TOP 30
      l.TinhTrang,
      t.Id         AS tax_id,
      t.TieuDe     AS tax_tieu_de,
      t.TaxonomyType
    FROM dbo.Lead l
    LEFT JOIN dbo.Taxonomy t ON t.Id = l.TinhTrang
    GROUP BY l.TinhTrang, t.Id, t.TieuDe, t.TaxonomyType
    ORDER BY l.TinhTrang
  `);
  console.table(joinTax.recordset);

  // ─── 6. Các TaxonomyType có thể liên quan đến "trạng thái lead" ────────────
  console.log('\n===== [6] Taxonomy có TieuDe chứa từ khoá trạng thái lead =====');
  const taxStatus = await req().query(`
    SELECT Id, TieuDe, TaxonomyType, TrangThai
    FROM dbo.Taxonomy
    WHERE TieuDe LIKE N'%new%'
       OR TieuDe LIKE N'%qualif%'
       OR TieuDe LIKE N'%negotiat%'
       OR TieuDe LIKE N'%closed%'
       OR TieuDe LIKE N'%mới%'
       OR TieuDe LIKE N'%xử lý%'
       OR TieuDe LIKE N'%loại%'
    ORDER BY TaxonomyType, Id
  `);
  console.table(taxStatus.recordset);

  await pool.close();
  console.log('\n✅ Xong!');
}

run().catch(err => {
  console.error('❌ Lỗi:', err.message);
  process.exit(1);
});
