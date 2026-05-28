const express = require('express');
const router = express.Router();
const { sql, getPool } = require('../db');

/**
 * @swagger
 * tags:
 *   name: Orders
 *   description: Quản lý đơn hàng (dbo.Order)
 */

/**
 * @swagger
 * /api/orders:
 *   get:
 *     summary: Danh sách đơn hàng
 *     tags: [Orders]
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
 *         name: date_from
 *         description: Lọc từ ngày (YYYY-MM-DD)
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         description: Lọc đến ngày (YYYY-MM-DD)
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: status
 *         description: Trạng thái (TrangThai) 0=xóa, 1=active
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Danh sách đơn hàng với phân trang
 */
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const page      = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit     = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset    = (page - 1) * limit;
    const dateFrom  = req.query.date_from || null;
    const dateTo    = req.query.date_to   || null;
    const status    = req.query.status !== undefined ? parseInt(req.query.status) : null;

    const conditions = [];
    const request = pool.request()
      .input('limit',  sql.Int, limit)
      .input('offset', sql.Int, offset);

    if (dateFrom) {
      conditions.push('o.NgayCapNhat >= @dateFrom');
      request.input('dateFrom', sql.DateTime, new Date(dateFrom));
    }
    if (dateTo) {
      conditions.push('o.NgayCapNhat <= @dateTo');
      request.input('dateTo', sql.DateTime, new Date(dateTo + 'T23:59:59'));
    }
    if (status !== null && !isNaN(status)) {
      conditions.push('o.TrangThai = @status');
      request.input('status', sql.TinyInt, status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countReq = pool.request();
    if (dateFrom) countReq.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   countReq.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));
    if (status !== null && !isNaN(status)) countReq.input('status', sql.TinyInt, status);

    const [countResult, dataResult] = await Promise.all([
      countReq.query(`SELECT COUNT(*) AS total FROM dbo.[Order] o ${where}`),
      request.query(`
        SELECT
          o.Id,
          o.SoPO,
          o.SoHopDong,
          o.MaVanDon,
          o.XuatHoaDon,
          o.TinhTrangDatHangId,
          o.TinhTrangThanhToanId,
          o.ShipCODId,
          o.PhiDonHang,
          o.PhiDaNop,
          o.PhiConLai,
          o.GhiChu,
          o.NgayGuiSkype,
          o.Deadline,
          o.NgayBanGiao,
          o.TrangThai,
          o.NguoiCapNhatId,
          o.NgayCapNhat
        FROM dbo.[Order] o
        ${where}
        ORDER BY o.NgayCapNhat DESC
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
    console.error('[GET /orders]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/orders/{id}:
 *   get:
 *     summary: Chi tiết một đơn hàng
 *     tags: [Orders]
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
      .query(`SELECT * FROM dbo.[Order] WHERE Id = @id`);

    if (!result.recordset.length) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    }
    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    console.error('[GET /orders/:id]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
