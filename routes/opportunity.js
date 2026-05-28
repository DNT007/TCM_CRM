const express = require('express');
const router  = express.Router();
const { sql, getPool } = require('../db');

/**
 * @swagger
 * tags:
 *   name: Opportunities
 *   description: Quản lý & phân tích Cơ hội bán hàng (dbo.Opportunity)
 */

// ─── Helper: xây WHERE clause chung ───────────────────────────────────────────
function buildWhere(alias, { dateFrom, dateTo } = {}, extra = []) {
  const conds = [`${alias}.TrangThai = 1`, ...extra];
  if (dateFrom) conds.push(`${alias}.NgayTao >= @dateFrom`);
  if (dateTo)   conds.push(`${alias}.NgayTao <= @dateTo`);
  return `WHERE ${conds.join(' AND ')}`;
}

function addDateParams(request, { dateFrom, dateTo }) {
  if (dateFrom) request.input('dateFrom', sql.DateTime, new Date(dateFrom));
  if (dateTo)   request.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));
}

// ─── Shared Swagger date params ────────────────────────────────────────────────
/**
 * @swagger
 * components:
 *   parameters:
 *     optyDateFrom:
 *       in: query
 *       name: date_from
 *       schema: { type: string, format: date }
 *       example: "2024-01-01"
 *     optyDateTo:
 *       in: query
 *       name: date_to
 *       schema: { type: string, format: date }
 *       example: "2024-12-31"
 */

// ══════════════════════════════════════════════════════════════════════════════
// 1. GET /api/opportunities/stats/by-time
//    Số cơ hội theo thời gian (ngày / tuần / tháng)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/opportunities/stats/by-time:
 *   get:
 *     summary: "Số cơ hội theo thời gian (ngày / tuần / tháng)"
 *     tags: [Opportunities]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/optyDateFrom'
 *       - $ref: '#/components/parameters/optyDateTo'
 *       - in: query
 *         name: group_by
 *         description: Nhóm theo ngày, tuần hoặc tháng
 *         schema: { type: string, enum: [day, week, month], default: month }
 *     responses:
 *       200:
 *         description: Số lượng cơ hội theo kỳ thời gian
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
 *                       period:       { type: string, example: "2024-01" }
 *                       tong_co_hoi: { type: integer }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/by-time', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || 'month'; // day | week | month

    let periodExpr;
    if (groupBy === 'day') {
      periodExpr = `FORMAT(o.NgayTao, 'yyyy-MM-dd')`;
    } else if (groupBy === 'week') {
      periodExpr = `CONCAT(YEAR(o.NgayTao), '-W', RIGHT('00' + CAST(DATEPART(isowk, o.NgayTao) AS VARCHAR(2)), 2))`;
    } else {
      periodExpr = `FORMAT(o.NgayTao, 'yyyy-MM')`;
    }

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });
    const where = buildWhere('o', { dateFrom, dateTo });

    const result = await request.query(`
      SELECT
        ${periodExpr}   AS period,
        COUNT(o.Id)     AS tong_co_hoi
      FROM dbo.Opportunity o
      ${where}
      GROUP BY ${periodExpr}
      ORDER BY period ASC
    `);

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, group_by: groupBy },
      data:    result.recordset,
    });
  } catch (err) {
    console.error('[GET /opportunities/stats/by-time]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. GET /api/opportunities/stats/by-sales-rep
//    Số cơ hội theo sales rep (người phụ trách)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/opportunities/stats/by-sales-rep:
 *   get:
 *     summary: "Số cơ hội theo sales rep / người phụ trách"
 *     tags: [Opportunities]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/optyDateFrom'
 *       - $ref: '#/components/parameters/optyDateTo'
 *     responses:
 *       200:
 *         description: Phân bố cơ hội theo nhân viên phụ trách
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
 *                       sales_rep_id:  { type: integer }
 *                       FullName:      { type: string }
 *                       UserName:      { type: string }
 *                       tong_co_hoi:  { type: integer }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/by-sales-rep', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });
    const where = buildWhere('o', { dateFrom, dateTo });

    const result = await request.query(`
      SELECT
        o.NguoiXuLyId                                   AS sales_rep_id,
        ISNULL(u.FullName, N'Chưa phân công')           AS FullName,
        ISNULL(u.UserName, '')                           AS UserName,
        COUNT(o.Id)                                      AS tong_co_hoi
      FROM dbo.Opportunity o
      LEFT JOIN dbo.[UserFunction] u ON o.NguoiXuLyId = u.UserId
      ${where}
      GROUP BY o.NguoiXuLyId, u.FullName, u.UserName
      ORDER BY tong_co_hoi DESC
    `);

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      data:    result.recordset,
    });
  } catch (err) {
    console.error('[GET /opportunities/stats/by-sales-rep]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. GET /api/opportunities/stats/pipeline-by-time
//    Tổng giá trị pipeline (Amount) theo thời gian (ngày / tuần / tháng)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/opportunities/stats/pipeline-by-time:
 *   get:
 *     summary: "Tổng giá trị pipeline theo thời gian (ngày / tuần / tháng)"
 *     tags: [Opportunities]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/optyDateFrom'
 *       - $ref: '#/components/parameters/optyDateTo'
 *       - in: query
 *         name: group_by
 *         description: Nhóm theo ngày, tuần hoặc tháng
 *         schema: { type: string, enum: [day, week, month], default: month }
 *     responses:
 *       200:
 *         description: Tổng giá trị pipeline theo kỳ thời gian
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
 *                       period:          { type: string, example: "2024-01" }
 *                       so_co_hoi:       { type: integer }
 *                       tong_gia_tri:    { type: number, description: "Tổng Amount (VNĐ)" }
 *                       trung_binh:      { type: number, description: "Trung bình Amount (VNĐ)" }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/pipeline-by-time', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || 'month'; // day | week | month

    let periodExpr;
    if (groupBy === 'day') {
      periodExpr = `FORMAT(o.NgayTao, 'yyyy-MM-dd')`;
    } else if (groupBy === 'week') {
      periodExpr = `CONCAT(YEAR(o.NgayTao), '-W', RIGHT('00' + CAST(DATEPART(isowk, o.NgayTao) AS VARCHAR(2)), 2))`;
    } else {
      periodExpr = `FORMAT(o.NgayTao, 'yyyy-MM')`;
    }

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });
    const where = buildWhere('o', { dateFrom, dateTo });

    const result = await request.query(`
      SELECT
        ${periodExpr}                     AS period,
        COUNT(o.Id)                       AS so_co_hoi,
        ISNULL(SUM(o.Amount), 0)          AS tong_gia_tri,
        ISNULL(AVG(o.Amount), 0)          AS trung_binh
      FROM dbo.Opportunity o
      ${where}
      GROUP BY ${periodExpr}
      ORDER BY period ASC
    `);

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, group_by: groupBy },
      data:    result.recordset,
    });
  } catch (err) {
    console.error('[GET /opportunities/stats/pipeline-by-time]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. GET /api/opportunities/stats/pipeline-by-sales-rep
//    Tổng giá trị pipeline (Amount) theo sales rep
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/opportunities/stats/pipeline-by-sales-rep:
 *   get:
 *     summary: "Tổng giá trị pipeline theo sales rep / người phụ trách"
 *     tags: [Opportunities]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/optyDateFrom'
 *       - $ref: '#/components/parameters/optyDateTo'
 *     responses:
 *       200:
 *         description: Tổng giá trị pipeline theo nhân viên phụ trách
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
 *                       so_co_hoi:      { type: integer }
 *                       tong_gia_tri:   { type: number, description: "Tổng Amount (VNĐ)" }
 *                       trung_binh:     { type: number, description: "Trung bình Amount (VNĐ)" }
 *                       max_gia_tri:    { type: number }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/pipeline-by-sales-rep', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });
    const where = buildWhere('o', { dateFrom, dateTo });

    const result = await request.query(`
      SELECT
        o.NguoiXuLyId                                    AS sales_rep_id,
        ISNULL(u.FullName, N'Chưa phân công')            AS FullName,
        ISNULL(u.UserName, '')                            AS UserName,
        COUNT(o.Id)                                       AS so_co_hoi,
        ISNULL(SUM(o.Amount), 0)                         AS tong_gia_tri,
        ISNULL(AVG(o.Amount), 0)                         AS trung_binh,
        ISNULL(MAX(o.Amount), 0)                         AS max_gia_tri
      FROM dbo.Opportunity o
      LEFT JOIN dbo.[UserFunction] u ON o.NguoiXuLyId = u.UserId
      ${where}
      GROUP BY o.NguoiXuLyId, u.FullName, u.UserName
      ORDER BY tong_gia_tri DESC
    `);

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      data:    result.recordset,
    });
  } catch (err) {
    console.error('[GET /opportunities/stats/pipeline-by-sales-rep]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. GET /api/opportunities/stats/funnel
//    Phân bố cơ hội theo stage – funnel view (TinhTrang)
//    TinhTrang: 2=Đang xử lý | 3=Đã báo giá | 4=Đã chốt | 5=Thất bại
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/opportunities/stats/funnel:
 *   get:
 *     summary: "Phân bố cơ hội theo stage – funnel view"
 *     description: |
 *       Trả về phân bố cơ hội theo TinhTrang (stage):
 *       - 2: Đang xử lý
 *       - 3: Đã báo giá
 *       - 4: Đã chốt
 *       - 5: Thất bại
 *     tags: [Opportunities]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/optyDateFrom'
 *       - $ref: '#/components/parameters/optyDateTo'
 *     responses:
 *       200:
 *         description: Funnel phân bố cơ hội theo stage
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_toan_bo: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       tinh_trang:      { type: integer }
 *                       ten_stage:       { type: string, example: "Đang xử lý" }
 *                       so_co_hoi:       { type: integer }
 *                       tong_gia_tri:    { type: number }
 *                       ti_le_so_luong:  { type: number, description: "% so với tổng" }
 *                       ti_le_gia_tri:   { type: number, description: "% giá trị so với tổng" }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/funnel', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    // Map TinhTrang → tên stage (dựa trên logic nghiệp vụ CRM)
    const STAGE_MAP = {
      2: 'Đang xử lý',
      3: 'Đã báo giá',
      4: 'Đã chốt',
      5: 'Thất bại',
    };

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });
    const where = buildWhere('o', { dateFrom, dateTo });

    const result = await request.query(`
      SELECT
        o.TinhTrang                      AS tinh_trang,
        COUNT(o.Id)                      AS so_co_hoi,
        ISNULL(SUM(o.Amount), 0)        AS tong_gia_tri
      FROM dbo.Opportunity o
      ${where}
      GROUP BY o.TinhTrang
      ORDER BY o.TinhTrang ASC
    `);

    const rows = result.recordset;
    const tongSoLuong = rows.reduce((s, r) => s + (r.so_co_hoi || 0), 0);
    const tongGiaTri  = rows.reduce((s, r) => s + Number(r.tong_gia_tri || 0), 0);

    const data = rows.map(r => ({
      tinh_trang:     r.tinh_trang,
      ten_stage:      STAGE_MAP[r.tinh_trang] || `Stage ${r.tinh_trang}`,
      so_co_hoi:      r.so_co_hoi,
      tong_gia_tri:   Number(r.tong_gia_tri),
      ti_le_so_luong: tongSoLuong > 0
        ? parseFloat(((r.so_co_hoi / tongSoLuong) * 100).toFixed(2))
        : 0,
      ti_le_gia_tri:  tongGiaTri > 0
        ? parseFloat(((Number(r.tong_gia_tri) / tongGiaTri) * 100).toFixed(2))
        : 0,
    }));

    res.json({
      success:       true,
      filter:        { date_from: dateFrom, date_to: dateTo },
      tong_toan_bo:  tongSoLuong,
      tong_gia_tri:  tongGiaTri,
      data,
    });
  } catch (err) {
    console.error('[GET /opportunities/stats/funnel]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. GET /api/opportunities/stats/lead-to-opportunity-time
//    Thời gian trung bình từ lead → cơ hội (theo ngày / giờ)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/opportunities/stats/lead-to-opportunity-time:
 *   get:
 *     summary: "Thời gian trung bình từ lead → cơ hội"
 *     description: |
 *       Tính thời gian chuyển đổi trung bình từ khi tạo Lead đến khi tạo Opportunity
 *       (JOIN dbo.Lead qua LeadId, chỉ tính các cặp hợp lệ: NgayTao Opportunity >= NgayTao Lead).
 *       Hỗ trợ lọc theo date_from / date_to (theo NgayTao Opportunity) và group_by để xem xu hướng theo thời gian.
 *     tags: [Opportunities]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/optyDateFrom'
 *       - $ref: '#/components/parameters/optyDateTo'
 *       - in: query
 *         name: group_by
 *         description: "Xem xu hướng theo kỳ (để trống = chỉ trả tổng hợp)"
 *         schema: { type: string, enum: [day, week, month] }
 *     responses:
 *       200:
 *         description: Thời gian trung bình lead → opportunity
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
 *                     trung_binh_ngay:   { type: number }
 *                     trung_binh_gio:    { type: number }
 *                     trung_binh_phut:   { type: number }
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
 *                       trung_binh_ngay: { type: number }
 *                       trung_binh_gio:  { type: number }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/lead-to-opportunity-time', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || null; // day | week | month | null

    // Base conditions: TrangThai=1 cho cả 2 bảng, opty.NgayTao >= lead.NgayTao
    const extraConds = ['l.TrangThai = 1', 'o.NgayTao >= l.NgayTao'];
    const where = buildWhere('o', { dateFrom, dateTo }, extraConds);

    // ── Summary (tổng hợp toàn bộ) ──────────────────────────────────────────
    const reqSummary = pool.request();
    addDateParams(reqSummary, { dateFrom, dateTo });

    const summaryResult = await reqSummary.query(`
      SELECT
        COUNT(*)                                                           AS tong_cap_hop_le,
        AVG(CAST(DATEDIFF(minute, l.NgayTao, o.NgayTao) AS FLOAT))        AS avg_phut,
        MIN(CAST(DATEDIFF(minute, l.NgayTao, o.NgayTao) AS FLOAT))        AS min_phut,
        MAX(CAST(DATEDIFF(minute, l.NgayTao, o.NgayTao) AS FLOAT))        AS max_phut
      FROM dbo.Opportunity o
      INNER JOIN dbo.Lead l ON o.LeadId = l.Id
      ${where}
    `);

    const s = summaryResult.recordset[0];
    const summary = {
      tong_cap_hop_le:  s.tong_cap_hop_le,
      trung_binh_phut:  s.avg_phut != null ? parseFloat(s.avg_phut.toFixed(2)) : null,
      trung_binh_gio:   s.avg_phut != null ? parseFloat((s.avg_phut / 60).toFixed(2)) : null,
      trung_binh_ngay:  s.avg_phut != null ? parseFloat((s.avg_phut / 1440).toFixed(4)) : null,
      min_ngay:         s.min_phut != null ? parseFloat((s.min_phut / 1440).toFixed(4)) : null,
      max_ngay:         s.max_phut != null ? parseFloat((s.max_phut / 1440).toFixed(4)) : null,
    };

    // ── Xu hướng theo kỳ (chỉ khi có group_by) ──────────────────────────────
    let trendData = [];
    if (groupBy) {
      let periodExpr;
      if (groupBy === 'day') {
        periodExpr = `FORMAT(o.NgayTao, 'yyyy-MM-dd')`;
      } else if (groupBy === 'week') {
        periodExpr = `CONCAT(YEAR(o.NgayTao), '-W', RIGHT('00' + CAST(DATEPART(isowk, o.NgayTao) AS VARCHAR(2)), 2))`;
      } else {
        periodExpr = `FORMAT(o.NgayTao, 'yyyy-MM')`;
      }

      const reqTrend = pool.request();
      addDateParams(reqTrend, { dateFrom, dateTo });

      const trendResult = await reqTrend.query(`
        SELECT
          ${periodExpr}                                                          AS period,
          COUNT(*)                                                               AS so_cap,
          AVG(CAST(DATEDIFF(minute, l.NgayTao, o.NgayTao) AS FLOAT))            AS avg_phut
        FROM dbo.Opportunity o
        INNER JOIN dbo.Lead l ON o.LeadId = l.Id
        ${where}
        GROUP BY ${periodExpr}
        ORDER BY period ASC
      `);

      trendData = trendResult.recordset.map(r => ({
        period:          r.period,
        so_cap:          r.so_cap,
        trung_binh_gio:  r.avg_phut != null ? parseFloat((r.avg_phut / 60).toFixed(2)) : null,
        trung_binh_ngay: r.avg_phut != null ? parseFloat((r.avg_phut / 1440).toFixed(4)) : null,
      }));
    }

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, group_by: groupBy },
      summary,
      data:    trendData,
    });
  } catch (err) {
    console.error('[GET /opportunities/stats/lead-to-opportunity-time]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. GET /api/opportunities/stats/by-product-group
//    Số cơ hội theo NHÓM SẢN PHẨM CHA
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/opportunities/stats/by-product-group:
 *   get:
 *     summary: "Số cơ hội theo nhóm sản phẩm CHA"
 *     description: |
 *       Thống kê cơ hội nhóm theo danh mục sản phẩm **cấp cha** (VD: "Thiết bị đo cơ khí chính xác", "Dụng cụ cầm tay").
 *       Nếu sản phẩm thuộc nhóm con thì tự động quy về nhóm cha.
 *       Join chain: Opportunity → Quotation → LinkQuotationProduct → Product → Taxonomy(NhomThietBi).
 *     tags: [Opportunities]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/optyDateFrom'
 *       - $ref: '#/components/parameters/optyDateTo'
 *     responses:
 *       200:
 *         description: Thống kê cơ hội theo nhóm sản phẩm cấp cha
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_co_hoi_co_san_pham: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       nhom_id:         { type: integer }
 *                       ten_nhom:        { type: string,  example: "Thiết bị đo cơ khí chính xác" }
 *                       so_co_hoi:       { type: integer }
 *                       tong_so_luong:   { type: integer }
 *                       tong_gia_tri:    { type: number }
 *                       trung_binh_gia:  { type: number }
 *                       ti_le:           { type: number,  description: "% so với tổng cơ hội có sản phẩm" }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/by-product-group', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const dateConds = [];
    if (dateFrom) dateConds.push(`o.NgayTao >= @dateFrom`);
    if (dateTo)   dateConds.push(`o.NgayTao <= @dateTo`);
    const baseWhere = ['o.TrangThai = 1', 'q.TrangThai != 0', ...dateConds].join(' AND ');

    const request = pool.request();
    if (dateFrom) request.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   request.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));

    // Nhóm cha: nếu tn có KhoaChaId → dùng cha (tnp), ngược lại dùng chính tn
    const result = await request.query(`
      SELECT
        ISNULL(tnp.Id,     tn.Id)      AS nhom_id,
        ISNULL(tnp.TieuDe, tn.TieuDe) AS ten_nhom,
        COUNT(DISTINCT o.Id)           AS so_co_hoi,
        SUM(lqp.SoLuong)               AS tong_so_luong,
        SUM(CAST(lqp.GiaBan AS FLOAT) * lqp.SoLuong) AS tong_gia_tri,
        AVG(CAST(lqp.GiaBan AS FLOAT))                AS trung_binh_gia
      FROM dbo.Opportunity o
      INNER JOIN dbo.Quotation              q   ON q.OpportunityId = o.Id
      INNER JOIN dbo.LinkQuotationProduct   lqp ON lqp.QuotationId = q.Id
      INNER JOIN dbo.Product                p   ON p.Id = lqp.ProductId
      LEFT  JOIN dbo.Taxonomy               tn  ON tn.Id  = p.NhomThietBiId
      LEFT  JOIN dbo.Taxonomy               tnp ON tnp.Id = tn.KhoaChaId
      WHERE ${baseWhere}
      GROUP BY ISNULL(tnp.Id, tn.Id), ISNULL(tnp.TieuDe, tn.TieuDe)
      ORDER BY so_co_hoi DESC
    `);

    // Tổng cơ hội có sản phẩm để tính tỷ lệ
    const reqTotal = pool.request();
    if (dateFrom) reqTotal.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   reqTotal.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));
    const totalResult = await reqTotal.query(`
      SELECT COUNT(DISTINCT o.Id) AS total
      FROM dbo.Opportunity o
      INNER JOIN dbo.Quotation            q   ON q.OpportunityId = o.Id
      INNER JOIN dbo.LinkQuotationProduct lqp ON lqp.QuotationId = q.Id
      WHERE ${baseWhere}
    `);
    const tongCoHoi = totalResult.recordset[0].total;

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      tong_co_hoi_co_san_pham: tongCoHoi,
      data: result.recordset.map(r => ({
        nhom_id:        r.nhom_id,
        ten_nhom:       r.ten_nhom || '(Chưa phân nhóm)',
        so_co_hoi:      r.so_co_hoi,
        tong_so_luong:  r.tong_so_luong,
        tong_gia_tri:   r.tong_gia_tri   != null ? Math.round(r.tong_gia_tri)   : 0,
        trung_binh_gia: r.trung_binh_gia != null ? Math.round(r.trung_binh_gia) : 0,
        ti_le: tongCoHoi > 0 ? parseFloat(((r.so_co_hoi / tongCoHoi) * 100).toFixed(2)) : 0,
      })),
    });
  } catch (err) {
    console.error('[GET /opportunities/stats/by-product-group]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. GET /api/opportunities/stats/by-product-subgroup
//    Số cơ hội theo NHÓM SẢN PHẨM CON (có drill-down theo nhóm cha)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/opportunities/stats/by-product-subgroup:
 *   get:
 *     summary: "Số cơ hội theo nhóm sản phẩm CON"
 *     description: |
 *       Thống kê cơ hội nhóm theo danh mục sản phẩm **cấp con** (VD: "Thước kẹp", "Đồng hồ so", "Ampe kìm").
 *       Mỗi dòng trả về kèm thông tin nhóm cha để dễ drill-down.
 *       Truyền `group_id` để lọc chỉ các nhóm con thuộc một nhóm cha cụ thể.
 *     tags: [Opportunities]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/optyDateFrom'
 *       - $ref: '#/components/parameters/optyDateTo'
 *       - in: query
 *         name: group_id
 *         description: ID nhóm sản phẩm CHA — lọc để chỉ lấy nhóm con của nhóm đó
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Thống kê cơ hội theo nhóm sản phẩm cấp con
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_co_hoi_co_san_pham: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       nhom_con_id:     { type: integer }
 *                       ten_nhom_con:    { type: string,  example: "Thước kẹp" }
 *                       nhom_cha_id:     { type: integer }
 *                       ten_nhom_cha:    { type: string,  example: "Thiết bị đo cơ khí chính xác" }
 *                       so_co_hoi:       { type: integer }
 *                       tong_so_luong:   { type: integer }
 *                       tong_gia_tri:    { type: number }
 *                       trung_binh_gia:  { type: number }
 *                       ti_le:           { type: number,  description: "% so với tổng cơ hội có sản phẩm" }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/by-product-subgroup', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupId  = req.query.group_id  ? parseInt(req.query.group_id, 10) : null;

    const dateConds = [];
    if (dateFrom) dateConds.push(`o.NgayTao >= @dateFrom`);
    if (dateTo)   dateConds.push(`o.NgayTao <= @dateTo`);
    // Lọc nhóm cha nếu có group_id
    if (groupId)  dateConds.push(`(tn.KhoaChaId = @groupId OR (tn.KhoaChaId IS NULL AND tn.Id = @groupId))`);
    const baseWhere = ['o.TrangThai = 1', 'q.TrangThai != 0', ...dateConds].join(' AND ');

    const request = pool.request();
    if (dateFrom) request.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   request.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));
    if (groupId)  request.input('groupId',  sql.Int, groupId);

    const result = await request.query(`
      SELECT
        tn.Id                          AS nhom_con_id,
        tn.TieuDe                      AS ten_nhom_con,
        tnp.Id                         AS nhom_cha_id,
        tnp.TieuDe                     AS ten_nhom_cha,
        COUNT(DISTINCT o.Id)           AS so_co_hoi,
        SUM(lqp.SoLuong)               AS tong_so_luong,
        SUM(CAST(lqp.GiaBan AS FLOAT) * lqp.SoLuong) AS tong_gia_tri,
        AVG(CAST(lqp.GiaBan AS FLOAT))                AS trung_binh_gia
      FROM dbo.Opportunity o
      INNER JOIN dbo.Quotation              q   ON q.OpportunityId = o.Id
      INNER JOIN dbo.LinkQuotationProduct   lqp ON lqp.QuotationId = q.Id
      INNER JOIN dbo.Product                p   ON p.Id = lqp.ProductId
      LEFT  JOIN dbo.Taxonomy               tn  ON tn.Id  = p.NhomThietBiId
      LEFT  JOIN dbo.Taxonomy               tnp ON tnp.Id = tn.KhoaChaId
      WHERE ${baseWhere}
      GROUP BY tn.Id, tn.TieuDe, tnp.Id, tnp.TieuDe
      ORDER BY so_co_hoi DESC
    `);

    // Tổng cơ hội có sản phẩm (phạm vi đã lọc group_id nếu có)
    const reqTotal = pool.request();
    if (dateFrom) reqTotal.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   reqTotal.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));
    if (groupId)  reqTotal.input('groupId',  sql.Int, groupId);
    const totalResult = await reqTotal.query(`
      SELECT COUNT(DISTINCT o.Id) AS total
      FROM dbo.Opportunity o
      INNER JOIN dbo.Quotation            q   ON q.OpportunityId = o.Id
      INNER JOIN dbo.LinkQuotationProduct lqp ON lqp.QuotationId = q.Id
      INNER JOIN dbo.Product              p   ON p.Id = lqp.ProductId
      LEFT  JOIN dbo.Taxonomy             tn  ON tn.Id  = p.NhomThietBiId
      WHERE ${baseWhere}
    `);
    const tongCoHoi = totalResult.recordset[0].total;

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, group_id: groupId },
      tong_co_hoi_co_san_pham: tongCoHoi,
      data: result.recordset.map(r => ({
        nhom_con_id:    r.nhom_con_id,
        ten_nhom_con:   r.ten_nhom_con  || '(Chưa phân nhóm)',
        nhom_cha_id:    r.nhom_cha_id,
        ten_nhom_cha:   r.ten_nhom_cha  || null,
        so_co_hoi:      r.so_co_hoi,
        tong_so_luong:  r.tong_so_luong,
        tong_gia_tri:   r.tong_gia_tri   != null ? Math.round(r.tong_gia_tri)   : 0,
        trung_binh_gia: r.trung_binh_gia != null ? Math.round(r.trung_binh_gia) : 0,
        ti_le: tongCoHoi > 0 ? parseFloat(((r.so_co_hoi / tongCoHoi) * 100).toFixed(2)) : 0,
      })),
    });
  } catch (err) {
    console.error('[GET /opportunities/stats/by-product-subgroup]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. GET /api/opportunities/stats/by-brand
//    Số cơ hội theo thương hiệu sản phẩm (ThuongHieu – Taxonomy type 6)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/opportunities/stats/by-brand:
 *   get:
 *     summary: "Số cơ hội theo thương hiệu sản phẩm"
 *     description: |
 *       Thống kê cơ hội theo thương hiệu sản phẩm (VD: Insize, Mitutoyo, Mahr...).
 *       Join chain: Opportunity → Quotation → LinkQuotationProduct → Product → Taxonomy(ThuongHieu).
 *       Cơ hội không có sản phẩm hoặc sản phẩm không rõ thương hiệu được gộp vào "Không rõ thương hiệu".
 *     tags: [Opportunities]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/optyDateFrom'
 *       - $ref: '#/components/parameters/optyDateTo'
 *     responses:
 *       200:
 *         description: Thống kê cơ hội theo thương hiệu
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_co_hoi_co_san_pham: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       thuong_hieu_id:  { type: integer }
 *                       ten_thuong_hieu: { type: string,  example: "Insize" }
 *                       so_co_hoi:       { type: integer }
 *                       tong_so_luong:   { type: integer }
 *                       tong_gia_tri:    { type: number }
 *                       trung_binh_gia:  { type: number }
 *                       ti_le:           { type: number,  description: "% so với tổng cơ hội có sản phẩm" }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/by-brand', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const dateConds = [];
    if (dateFrom) dateConds.push(`o.NgayTao >= @dateFrom`);
    if (dateTo)   dateConds.push(`o.NgayTao <= @dateTo`);
    const baseWhere = ['o.TrangThai = 1', 'q.TrangThai != 0', ...dateConds].join(' AND ');

    const request = pool.request();
    if (dateFrom) request.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   request.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));

    const result = await request.query(`
      SELECT
        p.ThuongHieuId                                         AS thuong_hieu_id,
        ISNULL(tb.TieuDe, N'Không rõ thương hiệu')            AS ten_thuong_hieu,
        COUNT(DISTINCT o.Id)                                   AS so_co_hoi,
        SUM(lqp.SoLuong)                                       AS tong_so_luong,
        SUM(CAST(lqp.GiaBan AS FLOAT) * lqp.SoLuong)          AS tong_gia_tri,
        AVG(CAST(lqp.GiaBan AS FLOAT))                         AS trung_binh_gia
      FROM dbo.Opportunity o
      INNER JOIN dbo.Quotation              q   ON q.OpportunityId = o.Id
      INNER JOIN dbo.LinkQuotationProduct   lqp ON lqp.QuotationId = q.Id
      INNER JOIN dbo.Product                p   ON p.Id = lqp.ProductId
      LEFT  JOIN dbo.Taxonomy               tb  ON tb.Id = p.ThuongHieuId
      WHERE ${baseWhere}
      GROUP BY p.ThuongHieuId, tb.TieuDe
      ORDER BY so_co_hoi DESC
    `);

    // Tổng cơ hội có sản phẩm để tính tỷ lệ
    const reqTotal = pool.request();
    if (dateFrom) reqTotal.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   reqTotal.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));
    const totalResult = await reqTotal.query(`
      SELECT COUNT(DISTINCT o.Id) AS total
      FROM dbo.Opportunity o
      INNER JOIN dbo.Quotation            q   ON q.OpportunityId = o.Id
      INNER JOIN dbo.LinkQuotationProduct lqp ON lqp.QuotationId = q.Id
      WHERE ${baseWhere}
    `);
    const tongCoHoi = totalResult.recordset[0].total;

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      tong_co_hoi_co_san_pham: tongCoHoi,
      data: result.recordset.map(r => ({
        thuong_hieu_id:  r.thuong_hieu_id,
        ten_thuong_hieu: r.ten_thuong_hieu,
        so_co_hoi:       r.so_co_hoi,
        tong_so_luong:   r.tong_so_luong,
        tong_gia_tri:    r.tong_gia_tri   != null ? Math.round(r.tong_gia_tri)   : 0,
        trung_binh_gia:  r.trung_binh_gia != null ? Math.round(r.trung_binh_gia) : 0,
        ti_le: tongCoHoi > 0 ? parseFloat(((r.so_co_hoi / tongCoHoi) * 100).toFixed(2)) : 0,
      })),
    });
  } catch (err) {
    console.error('[GET /opportunities/stats/by-brand]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. GET /api/opportunities/stats/by-product
//     Số cơ hội theo từng SẢN PHẨM cụ thể (drill-down đến mức Product)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/opportunities/stats/by-product:
 *   get:
 *     summary: "Số cơ hội theo từng sản phẩm / nhóm sản phẩm"
 *     description: |
 *       Thống kê cơ hội theo từng **sản phẩm cụ thể** (drill-down đến mức Product).
 *       Mỗi dòng trả về thông tin sản phẩm kèm nhóm cha / nhóm con và số cơ hội liên quan.
 *       - Dùng `group_id` để lọc theo **nhóm sản phẩm** (cha hoặc con).
 *       - Dùng `search` để tìm theo tên / mã sản phẩm.
 *       Join chain: Opportunity → Quotation → LinkQuotationProduct → Product → Taxonomy.
 *     tags: [Opportunities]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/optyDateFrom'
 *       - $ref: '#/components/parameters/optyDateTo'
 *       - in: query
 *         name: group_id
 *         description: Lọc theo ID nhóm sản phẩm (cha hoặc con)
 *         schema: { type: integer }
 *       - in: query
 *         name: search
 *         description: Tìm theo tên hoặc mã sản phẩm
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Thống kê cơ hội theo từng sản phẩm
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_san_pham: { type: integer, description: "Số sản phẩm có trong kết quả" }
 *                 tong_co_hoi_co_san_pham: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       product_id:      { type: integer }
 *                       ma_san_pham:     { type: string,  example: "INS-001" }
 *                       ten_san_pham:    { type: string,  example: "Thước kẹp Insize 1234-150" }
 *                       nhom_cha_id:     { type: integer }
 *                       ten_nhom_cha:    { type: string,  example: "Thiết bị đo cơ khí chính xác" }
 *                       nhom_con_id:     { type: integer }
 *                       ten_nhom_con:    { type: string,  example: "Thước kẹp" }
 *                       thuong_hieu:     { type: string,  example: "Insize" }
 *                       so_co_hoi:       { type: integer }
 *                       tong_so_luong:   { type: integer }
 *                       tong_gia_tri:    { type: number }
 *                       trung_binh_gia:  { type: number }
 *                       ti_le:           { type: number,  description: "% so với tổng cơ hội có sản phẩm" }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/by-product', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupId  = req.query.group_id  ? parseInt(req.query.group_id, 10) : null;
    const search   = req.query.search    ? req.query.search.trim() : null;

    // ── Xây WHERE ────────────────────────────────────────────────────────────
    const dateConds = [];
    if (dateFrom) dateConds.push(`o.NgayTao >= @dateFrom`);
    if (dateTo)   dateConds.push(`o.NgayTao <= @dateTo`);

    // Lọc theo nhóm sản phẩm: nhóm cha (tnp) hoặc nhóm con (tn)
    if (groupId) {
      dateConds.push(`(tnp.Id = @groupId OR (tnp.Id IS NULL AND tn.Id = @groupId) OR tn.Id = @groupId)`);
    }
    // Tìm theo tên / mã sản phẩm
    if (search) {
      dateConds.push(`(p.TenSanPham LIKE @search OR p.SKU LIKE @search)`);
    }

    const baseWhere = ['o.TrangThai = 1', 'q.TrangThai != 0', ...dateConds].join(' AND ');

    // ── Query chính ──────────────────────────────────────────────────────────
    const request = pool.request();
    if (dateFrom) request.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   request.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));
    if (groupId)  request.input('groupId',  sql.Int, groupId);
    if (search)   request.input('search',   sql.NVarChar, `%${search}%`);

    const result = await request.query(`
      SELECT
        p.Id                                                   AS product_id,
        ISNULL(p.SKU,  '')                                   AS ma_san_pham,
        ISNULL(p.TenSanPham, N'(Chưa có tên)')                AS ten_san_pham,
        tnp.Id                                                 AS nhom_cha_id,
        ISNULL(tnp.TieuDe,  N'(Chưa phân nhóm cha)')          AS ten_nhom_cha,
        tn.Id                                                  AS nhom_con_id,
        ISNULL(tn.TieuDe,   N'(Chưa phân nhóm)')              AS ten_nhom_con,
        ISNULL(tb.TieuDe,   N'Không rõ thương hiệu')          AS thuong_hieu,
        COUNT(DISTINCT o.Id)                                   AS so_co_hoi,
        SUM(lqp.SoLuong)                                       AS tong_so_luong,
        SUM(CAST(lqp.GiaBan AS FLOAT) * lqp.SoLuong)          AS tong_gia_tri,
        AVG(CAST(lqp.GiaBan AS FLOAT))                         AS trung_binh_gia
      FROM dbo.Opportunity o
      INNER JOIN dbo.Quotation              q   ON q.OpportunityId = o.Id
      INNER JOIN dbo.LinkQuotationProduct   lqp ON lqp.QuotationId = q.Id
      INNER JOIN dbo.Product                p   ON p.Id = lqp.ProductId
      LEFT  JOIN dbo.Taxonomy               tn  ON tn.Id  = p.NhomThietBiId
      LEFT  JOIN dbo.Taxonomy               tnp ON tnp.Id = tn.KhoaChaId
      LEFT  JOIN dbo.Taxonomy               tb  ON tb.Id  = p.ThuongHieuId
      WHERE ${baseWhere}
      GROUP BY
        p.Id, p.SKU, p.TenSanPham,
        tnp.Id, tnp.TieuDe,
        tn.Id,  tn.TieuDe,
        tb.TieuDe
      ORDER BY so_co_hoi DESC
    `);

    // ── Tổng cơ hội để tính tỷ lệ ───────────────────────────────────────────
    const reqTotal = pool.request();
    if (dateFrom) reqTotal.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   reqTotal.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));
    if (groupId)  reqTotal.input('groupId',  sql.Int, groupId);
    if (search)   reqTotal.input('search',   sql.NVarChar, `%${search}%`);

    const totalResult = await reqTotal.query(`
      SELECT COUNT(DISTINCT o.Id) AS total
      FROM dbo.Opportunity o
      INNER JOIN dbo.Quotation              q   ON q.OpportunityId = o.Id
      INNER JOIN dbo.LinkQuotationProduct   lqp ON lqp.QuotationId = q.Id
      INNER JOIN dbo.Product                p   ON p.Id = lqp.ProductId
      LEFT  JOIN dbo.Taxonomy               tn  ON tn.Id  = p.NhomThietBiId
      LEFT  JOIN dbo.Taxonomy               tnp ON tnp.Id = tn.KhoaChaId
      WHERE ${baseWhere}
    `);
    const tongCoHoi = totalResult.recordset[0].total;

    res.json({
      success: true,
      filter: {
        date_from: dateFrom,
        date_to:   dateTo,
        group_id:  groupId,
        search,
      },
      tong_san_pham:           result.recordset.length,
      tong_co_hoi_co_san_pham: tongCoHoi,
      data: result.recordset.map(r => ({
        product_id:     r.product_id,
        ma_san_pham:    r.ma_san_pham,
        ten_san_pham:   r.ten_san_pham,
        nhom_cha_id:    r.nhom_cha_id,
        ten_nhom_cha:   r.ten_nhom_cha,
        nhom_con_id:    r.nhom_con_id,
        ten_nhom_con:   r.ten_nhom_con,
        thuong_hieu:    r.thuong_hieu,
        so_co_hoi:      r.so_co_hoi,
        tong_so_luong:  r.tong_so_luong,
        tong_gia_tri:   r.tong_gia_tri   != null ? Math.round(r.tong_gia_tri)   : 0,
        trung_binh_gia: r.trung_binh_gia != null ? Math.round(r.trung_binh_gia) : 0,
        ti_le: tongCoHoi > 0 ? parseFloat(((r.so_co_hoi / tongCoHoi) * 100).toFixed(2)) : 0,
      })),
    });
  } catch (err) {
    console.error('[GET /opportunities/stats/by-product]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

