const express = require('express');
const router = express.Router();
const { sql, getPool } = require('../db');

/**
 * @swagger
 * tags:
 *   name: Reports
 *   description: Báo cáo tổng hợp cho dashboard (doanh thu, đơn hàng, khách hàng)
 */

// ─────────────────────────────────────────────────────────────
// GET /api/reports/revenue
// Tổng doanh thu theo ngày hoặc tháng
// Query: ?date_from=2024-01-01&date_to=2024-12-31&group_by=month|day
// ─────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/reports/revenue:
 *   get:
 *     summary: Tổng doanh thu theo khoảng thời gian
 *     tags: [Reports]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         required: true
 *         schema: { type: string, format: date }
 *         example: "2024-01-01"
 *       - in: query
 *         name: date_to
 *         required: true
 *         schema: { type: string, format: date }
 *         example: "2024-12-31"
 *       - in: query
 *         name: group_by
 *         description: Nhóm theo ngày (day) hoặc tháng (month)
 *         schema: { type: string, enum: [day, month], default: month }
 *     responses:
 *       200:
 *         description: Doanh thu theo nhóm thời gian
 */
router.get('/revenue', async (req, res) => {
  try {
    const pool = getPool();
    const dateFrom = req.query.date_from || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    const dateTo   = req.query.date_to   || new Date().toISOString().split('T')[0];
    const groupBy  = req.query.group_by === 'day' ? 'day' : 'month';

    const dateFormat = groupBy === 'day'
      ? "CONVERT(nvarchar(10), o.NgayCapNhat, 120)"           // YYYY-MM-DD
      : "FORMAT(o.NgayCapNhat, 'yyyy-MM')";                   // YYYY-MM

    const result = await pool.request()
      .input('dateFrom', sql.DateTime, new Date(dateFrom))
      .input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'))
      .query(`
        SELECT
          ${dateFormat} AS period,
          COUNT(*)                         AS so_don_hang,
          SUM(o.PhiDonHang)                AS tong_phi_don_hang,
          SUM(o.PhiDaNop)                  AS tong_da_nop,
          SUM(o.PhiConLai)                 AS tong_con_lai,
          AVG(o.PhiDonHang)                AS trung_binh_don_hang
        FROM dbo.[Order] o
        WHERE
          o.NgayCapNhat BETWEEN @dateFrom AND @dateTo
          AND o.TrangThai = 1
          AND o.PhiDonHang IS NOT NULL
        GROUP BY ${dateFormat}
        ORDER BY period ASC
      `);

    // Tổng summary
    const summaryResult = await pool.request()
      .input('dateFrom', sql.DateTime, new Date(dateFrom))
      .input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'))
      .query(`
        SELECT
          COUNT(*)         AS tong_don_hang,
          SUM(PhiDonHang)  AS tong_doanh_thu,
          SUM(PhiDaNop)    AS tong_da_nop,
          SUM(PhiConLai)   AS tong_chua_nop
        FROM dbo.[Order]
        WHERE NgayCapNhat BETWEEN @dateFrom AND @dateTo
          AND TrangThai = 1
      `);

    res.json({
      success: true,
      filter: { date_from: dateFrom, date_to: dateTo, group_by: groupBy },
      summary: summaryResult.recordset[0],
      data: result.recordset,
    });
  } catch (err) {
    console.error('[GET /reports/revenue]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/reports/orders-summary
// Thống kê đơn hàng theo trạng thái
// ─────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/reports/orders-summary:
 *   get:
 *     summary: Thống kê đơn hàng theo trạng thái thanh toán
 *     tags: [Reports]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 */
router.get('/orders-summary', async (req, res) => {
  try {
    const pool = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const conditions = ['o.TrangThai = 1'];
    const request = pool.request();
    if (dateFrom) {
      conditions.push('o.NgayCapNhat >= @dateFrom');
      request.input('dateFrom', sql.DateTime, new Date(dateFrom));
    }
    if (dateTo) {
      conditions.push('o.NgayCapNhat <= @dateTo');
      request.input('dateTo', sql.DateTime, new Date(dateTo + 'T23:59:59'));
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await request.query(`
      SELECT
        COUNT(*)                                   AS tong_don,
        SUM(PhiDonHang)                            AS tong_gia_tri,
        SUM(PhiDaNop)                              AS tong_da_nop,
        SUM(PhiConLai)                             AS tong_chua_nop,
        SUM(CASE WHEN TinhTrangThanhToanId = 1 THEN 1 ELSE 0 END) AS da_thanh_toan,
        SUM(CASE WHEN TinhTrangThanhToanId != 1 OR TinhTrangThanhToanId IS NULL THEN 1 ELSE 0 END) AS chua_thanh_toan,
        SUM(CASE WHEN PhiConLai > 0 THEN PhiConLai ELSE 0 END) AS tong_no_con_lai,
        AVG(PhiDonHang)                            AS gia_tri_tb_don
      FROM dbo.[Order] o
      ${where}
    `);

    res.json({
      success: true,
      filter: { date_from: dateFrom, date_to: dateTo },
      data: result.recordset[0],
    });
  } catch (err) {
    console.error('[GET /reports/orders-summary]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/reports/customers-summary
// Thống kê khách hàng mới theo thời gian
// ─────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/reports/customers-summary:
 *   get:
 *     summary: Thống kê khách hàng mới theo thời gian
 *     tags: [Reports]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: group_by
 *         schema: { type: string, enum: [day, month], default: month }
 */
router.get('/customers-summary', async (req, res) => {
  try {
    const pool = getPool();
    const dateFrom = req.query.date_from || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    const dateTo   = req.query.date_to   || new Date().toISOString().split('T')[0];
    const groupBy  = req.query.group_by === 'day' ? 'day' : 'month';

    const dateFormat = groupBy === 'day'
      ? "CONVERT(nvarchar(10), c.NgayCapNhat, 120)"
      : "FORMAT(c.NgayCapNhat, 'yyyy-MM')";

    const result = await pool.request()
      .input('dateFrom', sql.DateTime, new Date(dateFrom))
      .input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'))
      .query(`
        SELECT
          ${dateFormat} AS period,
          COUNT(*) AS so_khach_hang_moi
        FROM dbo.Customer c
        WHERE c.NgayCapNhat BETWEEN @dateFrom AND @dateTo
          AND c.TrangThai = 1
        GROUP BY ${dateFormat}
        ORDER BY period ASC
      `);

    // Tổng
    const summaryResult = await pool.request()
      .input('dateFrom', sql.DateTime, new Date(dateFrom))
      .input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'))
      .query(`
        SELECT
          COUNT(*) AS tong_khach_hang,
          SUM(CASE WHEN NgayCapNhat BETWEEN @dateFrom AND @dateTo THEN 1 ELSE 0 END) AS khach_hang_moi_ky
        FROM dbo.Customer
        WHERE TrangThai = 1
      `);

    res.json({
      success: true,
      filter: { date_from: dateFrom, date_to: dateTo, group_by: groupBy },
      summary: summaryResult.recordset[0],
      data: result.recordset,
    });
  } catch (err) {
    console.error('[GET /reports/customers-summary]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/reports/leads-funnel
// Phễu lead → opportunity → quotation → order
// ─────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/reports/leads-funnel:
 *   get:
 *     summary: Phễu chuyển đổi Lead → Opportunity → Quotation → Order
 *     tags: [Reports]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 */
router.get('/leads-funnel', async (req, res) => {
  try {
    const pool = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const buildWhere = (table, alias) => {
      const conditions = [`${alias}.TrangThai = 1`];
      if (dateFrom) conditions.push(`${alias}.NgayCapNhat >= @dateFrom`);
      if (dateTo)   conditions.push(`${alias}.NgayCapNhat <= @dateTo`);
      return `FROM dbo.${table} ${alias} WHERE ${conditions.join(' AND ')}`;
    };

    const request = pool.request();
    if (dateFrom) request.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   request.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));

    const result = await request.query(`
      SELECT
        (SELECT COUNT(*) ${buildWhere('Lead',        'l')}) AS tong_lead,
        (SELECT COUNT(*) ${buildWhere('Opportunity', 'o')}) AS tong_opportunity,
        (SELECT COUNT(*) ${buildWhere('Quotation',   'q')}) AS tong_quotation,
        (SELECT COUNT(*) FROM dbo.[Order] ord WHERE ord.TrangThai = 1
          ${dateFrom ? 'AND ord.NgayCapNhat >= @dateFrom' : ''}
          ${dateTo   ? 'AND ord.NgayCapNhat <= @dateTo'   : ''}) AS tong_order
    `);

    const row = result.recordset[0];
    const leads = row.tong_lead || 1; // avoid div by 0

    res.json({
      success: true,
      filter: { date_from: dateFrom, date_to: dateTo },
      data: {
        ...row,
        conversion: {
          lead_to_opportunity: row.tong_lead ? +((row.tong_opportunity / row.tong_lead) * 100).toFixed(1) : 0,
          opportunity_to_quotation: row.tong_opportunity ? +((row.tong_quotation / row.tong_opportunity) * 100).toFixed(1) : 0,
          quotation_to_order: row.tong_quotation ? +((row.tong_order / row.tong_quotation) * 100).toFixed(1) : 0,
        }
      },
    });
  } catch (err) {
    console.error('[GET /reports/leads-funnel]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
