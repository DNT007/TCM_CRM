const express = require('express');
const router = express.Router();
const { sql, getPool } = require('../db');

/**
 * @swagger
 * tags:
 *   name: Products
 *   description: Danh mục sản phẩm (dbo.Product)
 */

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Danh sách sản phẩm
 *     tags: [Products]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: search
 *         description: Tìm theo tên sản phẩm hoặc SKU
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Danh sách sản phẩm với phân trang
 */
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const page   = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit  = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;

    const conditions = ['p.TrangThai = 1'];
    const request = pool.request()
      .input('limit',  sql.Int, limit)
      .input('offset', sql.Int, offset);

    if (search) {
      conditions.push('(p.TenSanPham LIKE @search OR p.SKU LIKE @search)');
      request.input('search', sql.NVarChar, search);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countReq = pool.request();
    if (search) countReq.input('search', sql.NVarChar, search);

    const [countResult, dataResult] = await Promise.all([
      countReq.query(`SELECT COUNT(*) AS total FROM dbo.Product p ${where}`),
      request.query(`
        SELECT
          p.Id,
          p.SKU,
          p.TenSanPham,
          p.GiaNhap,
          p.GiaBan,
          p.DonVi,
          p.ThuongHieuId,
          p.NhomThietBiId,
          p.PimId,
          p.TrangThai,
          p.NgayCapNhat
        FROM dbo.Product p
        ${where}
        ORDER BY p.TenSanPham ASC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `)
    ]);

    const total = countResult.recordset[0].total;
    res.json({
      success: true,
      data: dataResult.recordset,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[GET /products]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     summary: Chi tiết một sản phẩm
 *     tags: [Products]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 */
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .input('id', sql.BigInt, parseInt(req.params.id))
      .query(`
        SELECT p.*, t.TenThuongHieu
        FROM dbo.Product p
        LEFT JOIN dbo.Taxonomy t ON t.Id = p.ThuongHieuId
        WHERE p.Id = @id
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm' });
    }
    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    console.error('[GET /products/:id]', err.message);
    // Fallback nếu join lỗi
    try {
      const pool = getPool();
      const result = await pool.request()
        .input('id', sql.BigInt, parseInt(req.params.id))
        .query(`SELECT * FROM dbo.Product WHERE Id = @id`);
      if (!result.recordset.length) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm' });
      }
      res.json({ success: true, data: result.recordset[0] });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  }
});

module.exports = router;
