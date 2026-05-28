const { connectDB } = require('../db');

async function main() {
  const pool = await connectDB();

  // Minh hoạ cấu trúc cha-con trong Taxonomy
  console.log('=== Taxonomy: Nhóm CHA (KhoaChaId IS NULL, TaxonomyType=7) ===');
  const cha = await pool.request().query(`
    SELECT Id, TieuDe, KhoaChaId
    FROM dbo.Taxonomy
    WHERE TaxonomyType = 7 AND KhoaChaId IS NULL
    ORDER BY Id
  `);
  cha.recordset.forEach(r => console.log(`  [CHA] Id=${r.Id} | "${r.TieuDe}"`));

  console.log('\n=== Taxonomy: Nhóm CON của "Thiết bị đo cơ khí chính xác" (Id=2167) ===');
  const con = await pool.request().query(`
    SELECT Id, TieuDe, KhoaChaId
    FROM dbo.Taxonomy
    WHERE KhoaChaId = 2167
    ORDER BY Id
  `);
  con.recordset.forEach(r => console.log(`  [CON] Id=${r.Id} | "${r.TieuDe}" → Cha=${r.KhoaChaId}`));

  console.log('\n=== Ví dụ: Product.NhomThietBiId trỏ vào đâu? ===');
  const prod = await pool.request().query(`
    SELECT TOP 6
      p.Id, p.TenSanPham,
      p.NhomThietBiId,
      tn.TieuDe   AS ten_nhom_truc_tiep,
      tn.KhoaChaId,
      tnp.TieuDe  AS ten_nhom_cha
    FROM dbo.Product p
    LEFT JOIN dbo.Taxonomy tn  ON tn.Id  = p.NhomThietBiId
    LEFT JOIN dbo.Taxonomy tnp ON tnp.Id = tn.KhoaChaId
    ORDER BY p.Id
  `);
  prod.recordset.forEach(r => {
    const loai = r.KhoaChaId ? 'NhomThietBiId → CON' : 'NhomThietBiId → CHA';
    console.log(`  ${loai}`);
    console.log(`    Sản phẩm: "${r.TenSanPham}"`);
    console.log(`    tn.Id=${r.NhomThietBiId} "${r.ten_nhom_truc_tiep}" | KhoaChaId=${r.KhoaChaId} | Nhóm cha: "${r.ten_nhom_cha || '(chính là cha)'}"`);
    console.log(`    → by-product-GROUP sẽ gộp vào: "${r.ten_nhom_cha || r.ten_nhom_truc_tiep}"`);
    console.log();
  });

  console.log('=== Logic SQL của by-product-group: ISNULL(tnp.Id, tn.Id) ===');
  console.log('  Nếu tn.KhoaChaId IS NULL  → tnp = NULL → ISNULL(NULL, tn.Id)   = tn.Id   (tn chính là cha)');
  console.log('  Nếu tn.KhoaChaId = 2167   → tnp = nhóm cha → ISNULL(tnp.Id, tn.Id) = tnp.Id (dùng cha)');
}

main().catch(console.error).finally(() => process.exit());
