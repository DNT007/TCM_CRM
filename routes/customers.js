const express = require('express');
const router = express.Router();
const { sql, getPool } = require('../db');

/**
 * @swagger
 * tags:
 *   name: Customers
 *   description: Quản lý khách hàng (dbo.Customer)
 */

/**
 * @swagger
 * /api/customers:
 *   get:
 *     summary: Danh sách khách hàng
 *     tags: [Customers]
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
 *         description: Tìm theo tên, số điện thoại, email
 *         schema: { type: string }
 *       - in: query
 *         name: date_from
 *         description: Lọc từ ngày (YYYY-MM-DD)
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         description: Lọc đến ngày (YYYY-MM-DD)
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Danh sách khách hàng với phân trang
 */
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const page     = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit    = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset   = (page - 1) * limit;
    const search   = req.query.search    ? `%${req.query.search}%` : null;
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const conditions = ['c.TrangThai = 1'];
    const request = pool.request()
      .input('limit',  sql.Int, limit)
      .input('offset', sql.Int, offset);

    if (search) {
      conditions.push('(c.TenKhachHang LIKE @search OR c.SoDiDong LIKE @search OR c.Email LIKE @search)');
      request.input('search', sql.NVarChar, search);
    }
    if (dateFrom) {
      conditions.push('c.NgayCapNhat >= @dateFrom');
      request.input('dateFrom', sql.DateTime, new Date(dateFrom));
    }
    if (dateTo) {
      conditions.push('c.NgayCapNhat <= @dateTo');
      request.input('dateTo', sql.DateTime, new Date(dateTo + 'T23:59:59'));
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countReq = pool.request();
    if (search)   countReq.input('search',   sql.NVarChar, search);
    if (dateFrom) countReq.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   countReq.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));

    const [countResult, dataResult] = await Promise.all([
      countReq.query(`SELECT COUNT(*) AS total FROM dbo.Customer c ${where}`),
      request.query(`
        SELECT
          c.Id,
          c.TenKhachHang,
          c.SoDiDong,
          c.Email,
          c.DiaChi,
          c.TinhTrang,
          c.TrangThai,
          c.NguoiTaoId,
          c.NgayTao,
          c.NguoiCapNhatId,
          c.NgayCapNhat
        FROM dbo.Customer c
        ${where}
        ORDER BY c.NgayCapNhat DESC
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
    console.error('[GET /customers]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/customers/{id}:
 *   get:
 *     summary: Chi tiết một khách hàng
 *     tags: [Customers]
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
      .query(`SELECT * FROM dbo.Customer WHERE Id = @id`);

    if (!result.recordset.length) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng' });
    }
    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    console.error('[GET /customers/:id]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
