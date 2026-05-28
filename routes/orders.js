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

// ─── Helper functions ──────────────────────────────────────────────────────────
function buildPeriodExpr(alias, groupBy) {
  const col = `${alias}.NgayCapNhat`;
  if (groupBy === 'day')  return `FORMAT(${col}, 'yyyy-MM-dd')`;
  if (groupBy === 'week') return `CONCAT(YEAR(${col}), '-W', RIGHT('00' + CAST(DATEPART(isowk, ${col}) AS VARCHAR(2)), 2))`;
  return `FORMAT(${col}, 'yyyy-MM')`;
}

function buildOrderWhere({ dateFrom, dateTo, status } = {}) {
  const conds = ['o.TrangThai = 1'];
  if (dateFrom) conds.push('o.NgayCapNhat >= @dateFrom');
  if (dateTo)   conds.push('o.NgayCapNhat <= @dateTo');
  if (status !== null && status !== undefined) conds.push('o.TinhTrangDatHangId = @status');
  return `WHERE ${conds.join(' AND ')}`;
}

function addOrderParams(request, { dateFrom, dateTo, status } = {}) {
  if (dateFrom) request.input('dateFrom', sql.DateTime, new Date(dateFrom));
  if (dateTo)   request.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));
  if (status !== null && status !== undefined) request.input('status', sql.Int, status);
}

// ──────────────────────────────────────────────────────────────────────────────
// STATS 1. GET /api/orders/stats/by-time
//   Số đơn hàng theo thời gian (ngày / tuần / tháng)
// ──────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/orders/stats/by-time:
 *   get:
 *     summary: "Số đơn hàng theo thời gian (ngày / tuần / tháng)"
 *     description: |
 *       Thống kê số lượng đơn hàng được tạo trong từng kỳ thời gian.
 *       Hỗ trợ lọc theo `date_from` / `date_to` và nhóm theo `group_by` (day / week / month).
 *     tags: [Orders]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *         example: "2024-01-01"
 *         description: Lọc từ ngày (yyyy-MM-dd)
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *         example: "2024-12-31"
 *         description: Lọc đến ngày (yyyy-MM-dd)
 *       - in: query
 *         name: group_by
 *         schema: { type: string, enum: [day, week, month], default: month }
 *         description: Nhóm theo ngày, tuần hoặc tháng
 *     responses:
 *       200:
 *         description: Số lượng đơn hàng theo kỳ thời gian
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_don_hang: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:        { type: string, example: "2024-01" }
 *                       so_don_hang:   { type: integer }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/by-time', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || 'month';

    const periodExpr = buildPeriodExpr('o', groupBy);
    const where      = buildOrderWhere({ dateFrom, dateTo });

    const request = pool.request();
    addOrderParams(request, { dateFrom, dateTo });

    const result = await request.query(`
      SELECT
        ${periodExpr}   AS period,
        COUNT(o.Id)     AS so_don_hang
      FROM dbo.[Order] o
      ${where}
      GROUP BY ${periodExpr}
      ORDER BY period ASC
    `);

    const tong_don_hang = result.recordset.reduce((s, r) => s + (r.so_don_hang || 0), 0);

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, group_by: groupBy },
      tong_don_hang,
      data:    result.recordset,
    });
  } catch (err) {
    console.error('[GET /orders/stats/by-time]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// STATS 2. GET /api/orders/stats/revenue-by-time
//   Doanh thu theo thời gian (ngày / tuần / tháng)
// ──────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/orders/stats/revenue-by-time:
 *   get:
 *     summary: "Doanh thu theo thời gian (ngày / tuần / tháng)"
 *     description: |
 *       Thống kê tổng doanh thu (`PhiDonHang`) và số đơn hàng theo từng kỳ thời gian.
 *       Hỗ trợ lọc theo `date_from` / `date_to` và nhóm theo `group_by` (day / week / month).
 *     tags: [Orders]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *         example: "2024-01-01"
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *         example: "2024-12-31"
 *       - in: query
 *         name: group_by
 *         schema: { type: string, enum: [day, week, month], default: month }
 *     responses:
 *       200:
 *         description: Doanh thu theo kỳ thời gian
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_doanh_thu: { type: number }
 *                 tong_don_hang:  { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:         { type: string, example: "2024-01" }
 *                       so_don_hang:    { type: integer }
 *                       tong_doanh_thu: { type: number, description: "Tổng PhiDonHang (VNĐ)" }
 *                       trung_binh:     { type: number, description: "Trung bình PhiDonHang" }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/revenue-by-time', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || 'month';

    const periodExpr = buildPeriodExpr('o', groupBy);
    const where      = buildOrderWhere({ dateFrom, dateTo });

    const request = pool.request();
    addOrderParams(request, { dateFrom, dateTo });

    const result = await request.query(`
      SELECT
        ${periodExpr}                              AS period,
        COUNT(o.Id)                                AS so_don_hang,
        ISNULL(SUM(CAST(o.PhiDonHang AS FLOAT)), 0) AS tong_doanh_thu,
        ISNULL(AVG(CAST(o.PhiDonHang AS FLOAT)), 0) AS trung_binh
      FROM dbo.[Order] o
      ${where}
      GROUP BY ${periodExpr}
      ORDER BY period ASC
    `);

    const tong_doanh_thu = result.recordset.reduce((s, r) => s + Number(r.tong_doanh_thu || 0), 0);
    const tong_don_hang  = result.recordset.reduce((s, r) => s + (r.so_don_hang || 0), 0);

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, group_by: groupBy },
      tong_doanh_thu: Math.round(tong_doanh_thu),
      tong_don_hang,
      data: result.recordset.map(r => ({
        period:         r.period,
        so_don_hang:    r.so_don_hang,
        tong_doanh_thu: Math.round(Number(r.tong_doanh_thu)),
        trung_binh:     Math.round(Number(r.trung_binh)),
      })),
    });
  } catch (err) {
    console.error('[GET /orders/stats/revenue-by-time]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// STATS 3. GET /api/orders/stats/revenue-by-sales-rep
//   Doanh thu theo sales rep (người cập nhật / người phụ trách đơn hàng)
// ──────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/orders/stats/revenue-by-sales-rep:
 *   get:
 *     summary: "Doanh thu theo sales rep / người phụ trách đơn hàng"
 *     description: |
 *       Thống kê tổng doanh thu (`PhiDonHang`) và số đơn hàng theo từng nhân viên phụ trách (`NguoiCapNhatId`).
 *       Kết quả sắp xếp giảm dần theo tổng doanh thu.
 *     tags: [Orders]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *         example: "2024-01-01"
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *         example: "2024-12-31"
 *     responses:
 *       200:
 *         description: Doanh thu theo nhân viên phụ trách
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       sales_rep_id:   { type: string }
 *                       FullName:       { type: string }
 *                       UserName:       { type: string }
 *                       so_don_hang:    { type: integer }
 *                       tong_doanh_thu: { type: number, description: "Tổng PhiDonHang (VNĐ)" }
 *                       trung_binh:     { type: number }
 *                       max_doanh_thu:  { type: number }
 *                       ti_le:          { type: number, description: "% doanh thu so với tổng" }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/revenue-by-sales-rep', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const where   = buildOrderWhere({ dateFrom, dateTo });
    const request = pool.request();
    addOrderParams(request, { dateFrom, dateTo });

    const result = await request.query(`
      SELECT
        o.NguoiCapNhatId                                   AS sales_rep_id,
        ISNULL(u.FullName, N'Chưa phân công')              AS FullName,
        ISNULL(u.UserName, '')                              AS UserName,
        COUNT(o.Id)                                         AS so_don_hang,
        ISNULL(SUM(CAST(o.PhiDonHang AS FLOAT)), 0)        AS tong_doanh_thu,
        ISNULL(AVG(CAST(o.PhiDonHang AS FLOAT)), 0)        AS trung_binh,
        ISNULL(MAX(CAST(o.PhiDonHang AS FLOAT)), 0)        AS max_doanh_thu
      FROM dbo.[Order] o
      LEFT JOIN dbo.[UserFunction] u ON o.NguoiCapNhatId = u.UserId
      ${where}
      GROUP BY o.NguoiCapNhatId, u.FullName, u.UserName
      ORDER BY tong_doanh_thu DESC
    `);

    const tongDoanhThu = result.recordset.reduce((s, r) => s + Number(r.tong_doanh_thu || 0), 0);

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      data: result.recordset.map(r => ({
        sales_rep_id:   r.sales_rep_id,
        FullName:       r.FullName,
        UserName:       r.UserName,
        so_don_hang:    r.so_don_hang,
        tong_doanh_thu: Math.round(Number(r.tong_doanh_thu)),
        trung_binh:     Math.round(Number(r.trung_binh)),
        max_doanh_thu:  Math.round(Number(r.max_doanh_thu)),
        ti_le: tongDoanhThu > 0
          ? parseFloat(((Number(r.tong_doanh_thu) / tongDoanhThu) * 100).toFixed(2))
          : 0,
      })),
    });
  } catch (err) {
    console.error('[GET /orders/stats/revenue-by-sales-rep]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// STATS 4. GET /api/orders/stats/revenue-by-product
//   Doanh thu theo sản phẩm / nhóm sản phẩm
//   Join chain: Order → Quotation (SoHopDong) → LinkQuotationProduct → Product → Taxonomy
// ──────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/orders/stats/revenue-by-product:
 *   get:
 *     summary: "Doanh thu theo sản phẩm / nhóm sản phẩm"
 *     description: |
 *       Thống kê doanh thu từ đơn hàng nhóm theo **sản phẩm** hoặc **nhóm sản phẩm** (Taxonomy).
 *       - `level=product`: nhóm theo từng sản phẩm cụ thể
 *       - `level=group` (mặc định): nhóm theo danh mục sản phẩm cấp cha (Taxonomy)
 *       - `level=subgroup`: nhóm theo danh mục sản phẩm cấp con
 *
 *       Join chain: `dbo.[Order]` → `dbo.Quotation` (qua `SoHopDong`) → `dbo.LinkQuotationProduct` → `dbo.Product` → `dbo.Taxonomy`.
 *     tags: [Orders]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *         example: "2024-01-01"
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *         example: "2024-12-31"
 *       - in: query
 *         name: level
 *         description: "Mức phân tích: product | group | subgroup"
 *         schema: { type: string, enum: [product, group, subgroup], default: group }
 *     responses:
 *       200:
 *         description: Doanh thu theo sản phẩm / nhóm sản phẩm
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_doanh_thu: { type: number }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:             { type: integer }
 *                       ten:            { type: string }
 *                       nhom_cha_id:    { type: integer, description: "Chỉ có ở level=subgroup" }
 *                       ten_nhom_cha:   { type: string,  description: "Chỉ có ở level=subgroup" }
 *                       so_don_hang:    { type: integer }
 *                       tong_so_luong:  { type: integer }
 *                       tong_doanh_thu: { type: number }
 *                       trung_binh_gia: { type: number }
 *                       ti_le:          { type: number, description: "% doanh thu so với tổng" }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/revenue-by-product', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const level    = req.query.level     || 'group'; // product | group | subgroup

    // Điều kiện ngày trên đơn hàng
    const dateConds = ['o.TrangThai = 1', 'q.TrangThai != 0'];
    if (dateFrom) dateConds.push('o.NgayCapNhat >= @dateFrom');
    if (dateTo)   dateConds.push('o.NgayCapNhat <= @dateTo');
    const whereClause = `WHERE ${dateConds.join(' AND ')}`;

    const request = pool.request();
    if (dateFrom) request.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   request.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));

    let selectCols, groupCols;

    if (level === 'product') {
      // Nhóm theo từng sản phẩm
      selectCols = `
        p.Id                                                        AS id,
        ISNULL(p.TenHang, N'(Không tên)')                          AS ten,
        p.MaHang                                                    AS ma_hang`;
      groupCols = `p.Id, p.TenHang, p.MaHang`;
    } else if (level === 'subgroup') {
      // Nhóm theo danh mục sản phẩm cấp con
      selectCols = `
        tn.Id                                                       AS id,
        ISNULL(tn.TieuDe, N'(Chưa phân nhóm)')                    AS ten,
        tnp.Id                                                      AS nhom_cha_id,
        ISNULL(tnp.TieuDe, N'(Nhóm gốc)')                         AS ten_nhom_cha`;
      groupCols = `tn.Id, tn.TieuDe, tnp.Id, tnp.TieuDe`;
    } else {
      // Mặc định: nhóm theo danh mục cấp cha
      selectCols = `
        ISNULL(tnp.Id,     tn.Id)                                  AS id,
        ISNULL(tnp.TieuDe, ISNULL(tn.TieuDe, N'(Chưa phân nhóm)')) AS ten`;
      groupCols = `ISNULL(tnp.Id, tn.Id), ISNULL(tnp.TieuDe, tn.TieuDe)`;
    }

    const result = await request.query(`
      SELECT
        ${selectCols},
        COUNT(DISTINCT o.Id)                                          AS so_don_hang,
        ISNULL(SUM(lqp.SoLuong), 0)                                 AS tong_so_luong,
        ISNULL(SUM(CAST(lqp.GiaBan AS FLOAT) * lqp.SoLuong), 0)    AS tong_doanh_thu,
        ISNULL(AVG(CAST(lqp.GiaBan AS FLOAT)), 0)                   AS trung_binh_gia
      FROM dbo.[Order] o
      INNER JOIN dbo.Quotation              q   ON q.SoHopDong = o.SoHopDong
      INNER JOIN dbo.LinkQuotationProduct   lqp ON lqp.QuotationId = q.Id
      INNER JOIN dbo.Product                p   ON p.Id = lqp.ProductId
      LEFT  JOIN dbo.Taxonomy               tn  ON tn.Id  = p.NhomThietBiId
      LEFT  JOIN dbo.Taxonomy               tnp ON tnp.Id = tn.KhoaChaId
      ${whereClause}
      GROUP BY ${groupCols}
      ORDER BY tong_doanh_thu DESC
    `);

    const tongDoanhThu = result.recordset.reduce((s, r) => s + Number(r.tong_doanh_thu || 0), 0);

    const data = result.recordset.map(r => {
      const row = {
        id:             r.id,
        ten:            r.ten,
        so_don_hang:    r.so_don_hang,
        tong_so_luong:  r.tong_so_luong,
        tong_doanh_thu: Math.round(Number(r.tong_doanh_thu)),
        trung_binh_gia: Math.round(Number(r.trung_binh_gia)),
        ti_le: tongDoanhThu > 0
          ? parseFloat(((Number(r.tong_doanh_thu) / tongDoanhThu) * 100).toFixed(2))
          : 0,
      };
      if (level === 'product')  { row.ma_hang = r.ma_hang; }
      if (level === 'subgroup') { row.nhom_cha_id = r.nhom_cha_id; row.ten_nhom_cha = r.ten_nhom_cha; }
      return row;
    });

    res.json({
      success:        true,
      filter:         { date_from: dateFrom, date_to: dateTo, level },
      tong_doanh_thu: Math.round(tongDoanhThu),
      data,
    });
  } catch (err) {
    console.error('[GET /orders/stats/revenue-by-product]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// STATS 5. GET /api/orders/stats/revenue-by-area
//   Doanh thu theo tỉnh / thành phố
//   Join: Order → Quotation (SoHopDong) → Lead → RawCustomer → Taxonomy(AreaId, TaxonomyType=1)
// ──────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/orders/stats/revenue-by-area:
 *   get:
 *     summary: "Doanh thu theo tỉnh / thành phố"
 *     description: |
 *       Thống kê doanh thu và số đơn hàng phân bổ theo tỉnh/thành phố.
 *       Join chain: `Order` → `Quotation` (SoHopDong) → `Lead` → `RawCustomer` → `Taxonomy` (AreaId, TaxonomyType=1).
 *     tags: [Orders]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *         example: "2024-01-01"
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *         example: "2024-12-31"
 *     responses:
 *       200:
 *         description: Doanh thu theo tỉnh/thành phố
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_doanh_thu: { type: number }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       area_id:        { type: integer }
 *                       tinh_thanh:     { type: string }
 *                       so_don_hang:    { type: integer }
 *                       tong_doanh_thu: { type: number }
 *                       ti_le:          { type: number }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/revenue-by-area', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const conds = ['o.TrangThai = 1', 'q.TrangThai != 0'];
    if (dateFrom) conds.push('o.NgayCapNhat >= @dateFrom');
    if (dateTo)   conds.push('o.NgayCapNhat <= @dateTo');
    const whereClause = `WHERE ${conds.join(' AND ')}`;

    const request = pool.request();
    if (dateFrom) request.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   request.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));

    const result = await request.query(`
      SELECT
        t.Id                                                        AS area_id,
        ISNULL(t.TieuDe, N'Không xác định')                        AS tinh_thanh,
        COUNT(DISTINCT o.Id)                                        AS so_don_hang,
        ISNULL(SUM(CAST(o.PhiDonHang AS FLOAT)), 0)                AS tong_doanh_thu
      FROM dbo.[Order] o
      INNER JOIN dbo.Quotation    q  ON q.SoHopDong = o.SoHopDong
      LEFT  JOIN dbo.Lead         l  ON l.Id = q.LeadId
      LEFT  JOIN dbo.RawCustomer  rc ON rc.Id = l.RawCustomerId
      LEFT  JOIN dbo.Taxonomy     t  ON t.Id  = rc.AreaId AND t.TaxonomyType = 1
      ${whereClause}
      GROUP BY t.Id, t.TieuDe
      ORDER BY tong_doanh_thu DESC
      OPTION (RECOMPILE)
    `);

    const tongDoanhThu = result.recordset.reduce((s, r) => s + Number(r.tong_doanh_thu || 0), 0);

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      tong_doanh_thu: Math.round(tongDoanhThu),
      data: result.recordset.map(r => ({
        area_id:        r.area_id,
        tinh_thanh:     r.tinh_thanh,
        so_don_hang:    r.so_don_hang,
        tong_doanh_thu: Math.round(Number(r.tong_doanh_thu)),
        ti_le: tongDoanhThu > 0
          ? parseFloat(((Number(r.tong_doanh_thu) / tongDoanhThu) * 100).toFixed(2))
          : 0,
      })),
    });
  } catch (err) {
    console.error('[GET /orders/stats/revenue-by-area]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// STATS 6. GET /api/orders/stats/revenue-by-customer-group
//   Doanh thu theo nhóm khách hàng (ClassifyType: 1=Doanh nghiệp, 2=Cá nhân)
// ──────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/orders/stats/revenue-by-customer-group:
 *   get:
 *     summary: "Doanh thu theo nhóm khách hàng"
 *     description: |
 *       Thống kê doanh thu theo nhóm khách hàng dựa trên `Customer.ClassifyType`:
 *       - **1**: Doanh nghiệp
 *       - **2**: Cá nhân
 *       - **null**: Không xác định
 *
 *       Join chain: `Order` → `Quotation` (SoHopDong) → `Opportunity` → `Customer` (PartnerId).
 *     tags: [Orders]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *         example: "2024-01-01"
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *         example: "2024-12-31"
 *     responses:
 *       200:
 *         description: Doanh thu theo nhóm khách hàng
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_doanh_thu: { type: number }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       classify_type:  { type: integer }
 *                       nhom_khach_hang: { type: string }
 *                       so_don_hang:    { type: integer }
 *                       so_khach_hang:  { type: integer }
 *                       tong_doanh_thu: { type: number }
 *                       trung_binh:     { type: number }
 *                       ti_le:          { type: number }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/revenue-by-customer-group', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const conds = ['o.TrangThai = 1', 'q.TrangThai != 0'];
    if (dateFrom) conds.push('o.NgayCapNhat >= @dateFrom');
    if (dateTo)   conds.push('o.NgayCapNhat <= @dateTo');
    const whereClause = `WHERE ${conds.join(' AND ')}`;

    const request = pool.request();
    if (dateFrom) request.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   request.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));

    const result = await request.query(`
      SELECT
        c.ClassifyType                                              AS classify_type,
        CASE c.ClassifyType
          WHEN 1 THEN N'Doanh nghiệp'
          WHEN 2 THEN N'Cá nhân'
          ELSE        N'Không xác định'
        END                                                         AS nhom_khach_hang,
        COUNT(DISTINCT o.Id)                                        AS so_don_hang,
        COUNT(DISTINCT c.Id)                                        AS so_khach_hang,
        ISNULL(SUM(CAST(o.PhiDonHang AS FLOAT)), 0)                AS tong_doanh_thu,
        ISNULL(AVG(CAST(o.PhiDonHang AS FLOAT)), 0)                AS trung_binh
      FROM dbo.[Order] o
      INNER JOIN dbo.Quotation    q  ON q.SoHopDong  = o.SoHopDong
      LEFT  JOIN dbo.Opportunity  op ON op.Id         = q.OpportunityId
      LEFT  JOIN dbo.Customer     c  ON c.Id          = op.PartnerId
      ${whereClause}
      GROUP BY c.ClassifyType
      ORDER BY tong_doanh_thu DESC
    `);

    const tongDoanhThu = result.recordset.reduce((s, r) => s + Number(r.tong_doanh_thu || 0), 0);

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      tong_doanh_thu: Math.round(tongDoanhThu),
      data: result.recordset.map(r => ({
        classify_type:   r.classify_type,
        nhom_khach_hang: r.nhom_khach_hang,
        so_don_hang:     r.so_don_hang,
        so_khach_hang:   r.so_khach_hang,
        tong_doanh_thu:  Math.round(Number(r.tong_doanh_thu)),
        trung_binh:      Math.round(Number(r.trung_binh)),
        ti_le: tongDoanhThu > 0
          ? parseFloat(((Number(r.tong_doanh_thu) / tongDoanhThu) * 100).toFixed(2))
          : 0,
      })),
    });
  } catch (err) {
    console.error('[GET /orders/stats/revenue-by-customer-group]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// STATS 7. GET /api/orders/stats/avg-deal-size
//   Giá trị đơn hàng trung bình (Average Deal Size)
//   Hỗ trợ group_by (day/week/month) và lọc theo sales rep
// ──────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/orders/stats/avg-deal-size:
 *   get:
 *     summary: "Giá trị đơn hàng trung bình (Average Deal Size)"
 *     description: |
 *       Tính giá trị đơn hàng trung bình (`AVG(PhiDonHang)`) theo từng kỳ thời gian.
 *       Trả về summary tổng hợp và (nếu có `group_by`) xu hướng theo ngày/tuần/tháng.
 *       Hỗ trợ lọc theo `sales_rep_id` để xem theo nhân viên cụ thể.
 *     tags: [Orders]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *         example: "2024-01-01"
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *         example: "2024-12-31"
 *       - in: query
 *         name: group_by
 *         description: "Xem xu hướng theo kỳ (để trống = chỉ trả summary)"
 *         schema: { type: string, enum: [day, week, month] }
 *       - in: query
 *         name: sales_rep_id
 *         description: "Lọc theo ID nhân viên cụ thể"
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Giá trị đơn hàng trung bình
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 summary:
 *                   type: object
 *                   properties:
 *                     tong_don_hang:    { type: integer }
 *                     avg_deal_size:    { type: number, description: "Giá trị TB (VNĐ)" }
 *                     min_deal_size:    { type: number }
 *                     max_deal_size:    { type: number }
 *                     tong_doanh_thu:   { type: number }
 *                 data:
 *                   type: array
 *                   description: Xu hướng theo kỳ (chỉ trả khi có group_by)
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:         { type: string }
 *                       so_don_hang:    { type: integer }
 *                       avg_deal_size:  { type: number }
 *                       tong_doanh_thu: { type: number }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/avg-deal-size', async (req, res) => {
  try {
    const pool       = getPool();
    const dateFrom   = req.query.date_from    || null;
    const dateTo     = req.query.date_to      || null;
    const groupBy    = req.query.group_by     || null;
    const salesRepId = req.query.sales_rep_id || null;

    const conds = ['o.TrangThai = 1', 'o.PhiDonHang IS NOT NULL'];
    if (dateFrom)   conds.push('o.NgayCapNhat >= @dateFrom');
    if (dateTo)     conds.push('o.NgayCapNhat <= @dateTo');
    if (salesRepId) conds.push('o.NguoiCapNhatId = @salesRepId');
    const whereClause = `WHERE ${conds.join(' AND ')}`;

    // ── Summary ──────────────────────────────────────────────────────────────
    const reqSummary = pool.request();
    if (dateFrom)   reqSummary.input('dateFrom',   sql.DateTime, new Date(dateFrom));
    if (dateTo)     reqSummary.input('dateTo',     sql.DateTime, new Date(dateTo + 'T23:59:59'));
    if (salesRepId) reqSummary.input('salesRepId', sql.NVarChar, salesRepId);

    const summaryResult = await reqSummary.query(`
      SELECT
        COUNT(o.Id)                                AS tong_don_hang,
        AVG(CAST(o.PhiDonHang AS FLOAT))           AS avg_deal_size,
        MIN(CAST(o.PhiDonHang AS FLOAT))           AS min_deal_size,
        MAX(CAST(o.PhiDonHang AS FLOAT))           AS max_deal_size,
        SUM(CAST(o.PhiDonHang AS FLOAT))           AS tong_doanh_thu
      FROM dbo.[Order] o
      ${whereClause}
    `);

    const s = summaryResult.recordset[0];
    const summary = {
      tong_don_hang:  s.tong_don_hang  || 0,
      avg_deal_size:  s.avg_deal_size  != null ? Math.round(s.avg_deal_size)  : null,
      min_deal_size:  s.min_deal_size  != null ? Math.round(s.min_deal_size)  : null,
      max_deal_size:  s.max_deal_size  != null ? Math.round(s.max_deal_size)  : null,
      tong_doanh_thu: s.tong_doanh_thu != null ? Math.round(s.tong_doanh_thu) : 0,
    };

    // ── Xu hướng theo kỳ (chỉ khi có group_by) ───────────────────────────────
    let trendData = [];
    if (groupBy) {
      const periodExpr = buildPeriodExpr('o', groupBy);

      const reqTrend = pool.request();
      if (dateFrom)   reqTrend.input('dateFrom',   sql.DateTime, new Date(dateFrom));
      if (dateTo)     reqTrend.input('dateTo',     sql.DateTime, new Date(dateTo + 'T23:59:59'));
      if (salesRepId) reqTrend.input('salesRepId', sql.NVarChar, salesRepId);

      const trendResult = await reqTrend.query(`
        SELECT
          ${periodExpr}                          AS period,
          COUNT(o.Id)                            AS so_don_hang,
          AVG(CAST(o.PhiDonHang AS FLOAT))       AS avg_deal_size,
          SUM(CAST(o.PhiDonHang AS FLOAT))       AS tong_doanh_thu
        FROM dbo.[Order] o
        ${whereClause}
        GROUP BY ${periodExpr}
        ORDER BY period ASC
      `);

      trendData = trendResult.recordset.map(r => ({
        period:         r.period,
        so_don_hang:    r.so_don_hang,
        avg_deal_size:  r.avg_deal_size  != null ? Math.round(r.avg_deal_size)  : null,
        tong_doanh_thu: r.tong_doanh_thu != null ? Math.round(r.tong_doanh_thu) : 0,
      }));
    }

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, group_by: groupBy, sales_rep_id: salesRepId },
      summary,
      data: trendData,
    });
  } catch (err) {
    console.error('[GET /orders/stats/avg-deal-size]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// STATS 8. GET /api/orders/stats/quotation-to-order-time
//   Thời gian trung bình từ báo giá → chốt đơn hàng
//   Tính DATEDIFF(minute, Quotation.NgayTao, Order.NgayCapNhat)
//   Join qua SoHopDong (chỉ lấy cặp hợp lệ: Order.NgayCapNhat >= Quotation.NgayTao)
// ──────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/orders/stats/quotation-to-order-time:
 *   get:
 *     summary: "Thời gian trung bình từ báo giá → chốt đơn hàng"
 *     description: |
 *       Tính thời gian chuyển đổi trung bình từ khi tạo **Quotation** đến khi tạo **Order**
 *       (JOIN qua `SoHopDong`, chỉ tính cặp hợp lệ: `Order.NgayCapNhat >= Quotation.NgayTao`).
 *       Trả về summary tổng hợp và (nếu có `group_by`) xu hướng theo kỳ thời gian.
 *     tags: [Orders]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *         example: "2024-01-01"
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *         example: "2024-12-31"
 *       - in: query
 *         name: group_by
 *         description: "Xem xu hướng theo kỳ (để trống = chỉ trả summary)"
 *         schema: { type: string, enum: [day, week, month] }
 *     responses:
 *       200:
 *         description: Thời gian trung bình quotation → order
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 summary:
 *                   type: object
 *                   properties:
 *                     tong_cap_hop_le:   { type: integer }
 *                     trung_binh_phut:   { type: number }
 *                     trung_binh_gio:    { type: number }
 *                     trung_binh_ngay:   { type: number }
 *                     min_ngay:          { type: number }
 *                     max_ngay:          { type: number }
 *                 data:
 *                   type: array
 *                   description: Xu hướng theo kỳ (chỉ trả khi có group_by)
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:          { type: string }
 *                       so_cap:          { type: integer }
 *                       trung_binh_gio:  { type: number }
 *                       trung_binh_ngay: { type: number }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/quotation-to-order-time', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || null;

    const conds = [
      'o.TrangThai = 1',
      'q.TrangThai != 0',
      'o.SoHopDong IS NOT NULL',
      'o.NgayCapNhat >= q.NgayTao',
    ];
    if (dateFrom) conds.push('o.NgayCapNhat >= @dateFrom');
    if (dateTo)   conds.push('o.NgayCapNhat <= @dateTo');
    const whereClause = `WHERE ${conds.join(' AND ')}`;

    // ── Summary ──────────────────────────────────────────────────────────────
    const reqSummary = pool.request();
    if (dateFrom) reqSummary.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   reqSummary.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));

    const summaryResult = await reqSummary.query(`
      SELECT
        COUNT(*)                                                              AS tong_cap_hop_le,
        AVG(CAST(DATEDIFF(minute, q.NgayTao, o.NgayCapNhat) AS FLOAT))       AS avg_phut,
        MIN(CAST(DATEDIFF(minute, q.NgayTao, o.NgayCapNhat) AS FLOAT))       AS min_phut,
        MAX(CAST(DATEDIFF(minute, q.NgayTao, o.NgayCapNhat) AS FLOAT))       AS max_phut
      FROM dbo.[Order] o
      INNER JOIN dbo.Quotation q ON q.SoHopDong = o.SoHopDong
      ${whereClause}
    `);

    const s = summaryResult.recordset[0];
    const summary = {
      tong_cap_hop_le: s.tong_cap_hop_le || 0,
      trung_binh_phut: s.avg_phut != null ? parseFloat(s.avg_phut.toFixed(2))            : null,
      trung_binh_gio:  s.avg_phut != null ? parseFloat((s.avg_phut / 60).toFixed(2))     : null,
      trung_binh_ngay: s.avg_phut != null ? parseFloat((s.avg_phut / 1440).toFixed(4))   : null,
      min_ngay:        s.min_phut != null ? parseFloat((s.min_phut / 1440).toFixed(4))   : null,
      max_ngay:        s.max_phut != null ? parseFloat((s.max_phut / 1440).toFixed(4))   : null,
    };

    // ── Xu hướng theo kỳ (chỉ khi có group_by) ───────────────────────────────
    let trendData = [];
    if (groupBy) {
      const periodExpr = buildPeriodExpr('o', groupBy);

      const reqTrend = pool.request();
      if (dateFrom) reqTrend.input('dateFrom', sql.DateTime, new Date(dateFrom));
      if (dateTo)   reqTrend.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));

      const trendResult = await reqTrend.query(`
        SELECT
          ${periodExpr}                                                           AS period,
          COUNT(*)                                                                AS so_cap,
          AVG(CAST(DATEDIFF(minute, q.NgayTao, o.NgayCapNhat) AS FLOAT))         AS avg_phut
        FROM dbo.[Order] o
        INNER JOIN dbo.Quotation q ON q.SoHopDong = o.SoHopDong
        ${whereClause}
        GROUP BY ${periodExpr}
        ORDER BY period ASC
      `);

      trendData = trendResult.recordset.map(r => ({
        period:          r.period,
        so_cap:          r.so_cap,
        trung_binh_gio:  r.avg_phut != null ? parseFloat((r.avg_phut / 60).toFixed(2))   : null,
        trung_binh_ngay: r.avg_phut != null ? parseFloat((r.avg_phut / 1440).toFixed(4)) : null,
      }));
    }

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, group_by: groupBy },
      summary,
      data: trendData,
    });
  } catch (err) {
    console.error('[GET /orders/stats/quotation-to-order-time]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────

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
