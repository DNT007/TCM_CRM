const express = require('express');
const router  = express.Router();
const { sql, getPool } = require('../db');

/**
 * @swagger
 * tags:
 *   name: Activity
 *   description: Thống kê hoạt động (gọi điện, email, gặp mặt...)
 */

// ─── Helper: build date WHERE fragment ────────────────────────────────────────
function buildDateWhere(alias, dateCol, { dateFrom, dateTo } = {}, extraConds = []) {
  const conds = [...extraConds];
  if (dateFrom) conds.push(`${alias}.${dateCol} >= @dateFrom`);
  if (dateTo)   conds.push(`${alias}.${dateCol} <= @dateTo`);
  return conds.length ? `AND ${conds.join(' AND ')}` : '';
}

function addDateParams(request, { dateFrom, dateTo }) {
  if (dateFrom) request.input('dateFrom', sql.DateTime, new Date(dateFrom));
  if (dateTo)   request.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));
}

function buildPeriodExpr(alias, col, groupBy) {
  const c = `${alias}.${col}`;
  if (groupBy === 'day')  return `FORMAT(${c}, 'yyyy-MM-dd')`;
  if (groupBy === 'week') return `CONCAT(YEAR(${c}), '-W', RIGHT('00' + CAST(DATEPART(isowk, ${c}) AS VARCHAR(2)), 2))`;
  return `FORMAT(${c}, 'yyyy-MM')`;
}

// ─── Shared Swagger parameters ────────────────────────────────────────────────
/**
 * @swagger
 * components:
 *   parameters:
 *     actDateFrom:
 *       in: query
 *       name: date_from
 *       schema: { type: string, format: date }
 *       description: Lọc từ ngày (yyyy-MM-dd)
 *       example: "2024-01-01"
 *     actDateTo:
 *       in: query
 *       name: date_to
 *       schema: { type: string, format: date }
 *       description: Lọc đến ngày (yyyy-MM-dd)
 *       example: "2024-12-31"
 *     actGroupBy:
 *       in: query
 *       name: group_by
 *       description: Nhóm theo thời gian (day | week | month)
 *       schema: { type: string, enum: [day, week, month] }
 */

// ══════════════════════════════════════════════════════════════════════════════
// 1. GET /api/activity/stats/by-type-over-time
//    Số activity theo loại (gọi điện, email, gặp mặt...) theo thời gian
//    - Loại ActivityType = 1 (Log hệ thống auto-generated)
//    - Dùng NgayBatDau làm cột thời gian (thời điểm thực tế diễn ra hoạt động)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/activity/stats/by-type-over-time:
 *   get:
 *     summary: "Số activity theo loại và theo thời gian"
 *     description: |
 *       Thống kê số lượng hoạt động sales (Activity) phân loại theo loại hình.
 *       - **Chỉ tính hoạt động thực tế**: loại trừ `ActivityType = 1` (Log hệ thống tự động).
 *       - **Mapping loại**: 2 = Gọi điện, 3 = Email, 4 = Gặp mặt/Họp, 5 = Nhiệm vụ, 6 = Khác.
 *       - **Lọc ngày** theo `NgayBatDau` (thời điểm thực tế diễn ra hoạt động).
 *       - Hỗ trợ `group_by` để xem xu hướng theo ngày / tuần / tháng.
 *
 *       Kết quả trả về:
 *       - `summary`: tổng hợp theo từng loại (kèm `activity_type` value và `ti_le_phan_tram`).
 *       - `data`: phân bổ theo kỳ thời gian (chỉ có khi truyền `group_by`).
 *     tags: [Activity]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/actDateFrom'
 *       - $ref: '#/components/parameters/actDateTo'
 *       - $ref: '#/components/parameters/actGroupBy'
 *     responses:
 *       200:
 *         description: Thống kê activity theo loại và thời gian
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_activity: { type: integer, description: "Tổng số activity trong khoảng lọc" }
 *                 summary:
 *                   type: array
 *                   description: Tổng hợp theo loại activity
 *                   items:
 *                     type: object
 *                     properties:
 *                       activity_type:   { type: integer, description: "Giá trị ActivityType (2-6)" }
 *                       loai_hoat_dong:  { type: string,  description: "Tên loại hoạt động" }
 *                       so_luong:        { type: integer, description: "Số lượng activity" }
 *                       ti_le_phan_tram: { type: number,  description: "Tỉ lệ % trên tổng" }
 *                 data:
 *                   type: array
 *                   description: Xu hướng theo kỳ và loại activity (chỉ có khi truyền group_by)
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:          { type: string }
 *                       activity_type:   { type: integer }
 *                       loai_hoat_dong:  { type: string }
 *                       so_luong:        { type: integer }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/by-type-over-time', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || null;

    // Dùng NgayBatDau (thời điểm thực tế diễn ra), fallback NgayTao nếu null
    // Loại ActivityType = 1 (Log hệ thống auto-generated, không phải hoạt động sales)
    // Loại dirty data: ngày tương lai bất thường (VD: có record NgayBatDau = năm 5202)
    const conds = [
      'a.TrangThai = 1',
      'a.ActivityType != 1',
      'ISNULL(a.NgayBatDau, a.NgayTao) <= GETDATE()', // loại dirty data ngày tương lai
    ];
    if (dateFrom) conds.push('ISNULL(a.NgayBatDau, a.NgayTao) >= @dateFrom');
    if (dateTo)   conds.push('ISNULL(a.NgayBatDau, a.NgayTao) <= @dateTo');
    const whereClause = 'WHERE ' + conds.join(' AND ');

    // ── Summary: tổng theo loại hoạt động ────────────────────────────────────
    const reqSum = pool.request();
    if (dateFrom) reqSum.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   reqSum.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));

    const sumResult = await reqSum.query(`
      SELECT
        a.ActivityType                                    AS activity_type,
        CASE a.ActivityType
          WHEN 2 THEN N'Gọi điện'
          WHEN 3 THEN N'Email'
          WHEN 4 THEN N'Gặp mặt / Họp'
          WHEN 5 THEN N'Nhiệm vụ'
          WHEN 6 THEN N'Khác'
          ELSE N'Không xác định'
        END                                               AS loai_hoat_dong,
        COUNT(a.Id)                                       AS so_luong
      FROM dbo.Activity a
      ${whereClause}
      GROUP BY a.ActivityType
      ORDER BY so_luong DESC
    `);

    const tongActivity = sumResult.recordset.reduce((s, r) => s + (r.so_luong || 0), 0);

    const summary = sumResult.recordset.map(r => ({
      activity_type:   r.activity_type,
      loai_hoat_dong:  r.loai_hoat_dong,
      so_luong:        r.so_luong,
      ti_le_phan_tram: tongActivity > 0
        ? parseFloat(((r.so_luong / tongActivity) * 100).toFixed(2))
        : 0,
    }));

    // ── Xu hướng theo kỳ + loại ──────────────────────────────────────────────
    let trendData = [];
    if (groupBy) {
      // Nhóm theo NgayBatDau (fallback NgayTao)
      const c          = 'ISNULL(a.NgayBatDau, a.NgayTao)';
      let periodExpr;
      if (groupBy === 'day')  periodExpr = `FORMAT(${c}, 'yyyy-MM-dd')`;
      else if (groupBy === 'week') periodExpr = `CONCAT(YEAR(${c}), '-W', RIGHT('00' + CAST(DATEPART(isowk, ${c}) AS VARCHAR(2)), 2))`;
      else                    periodExpr = `FORMAT(${c}, 'yyyy-MM')`;

      const reqTrend = pool.request();
      if (dateFrom) reqTrend.input('dateFrom', sql.DateTime, new Date(dateFrom));
      if (dateTo)   reqTrend.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));

      const trendResult = await reqTrend.query(`
        SELECT
          ${periodExpr}                                   AS period,
          a.ActivityType                                  AS activity_type,
          CASE a.ActivityType
            WHEN 2 THEN N'Gọi điện'
            WHEN 3 THEN N'Email'
            WHEN 4 THEN N'Gặp mặt / Họp'
            WHEN 5 THEN N'Nhiệm vụ'
            WHEN 6 THEN N'Khác'
            ELSE N'Không xác định'
          END                                             AS loai_hoat_dong,
          COUNT(a.Id)                                     AS so_luong
        FROM dbo.Activity a
        ${whereClause}
        GROUP BY ${periodExpr}, a.ActivityType
        ORDER BY period ASC, so_luong DESC
      `);

      trendData = trendResult.recordset.map(r => ({
        period:         r.period,
        activity_type:  r.activity_type,
        loai_hoat_dong: r.loai_hoat_dong,
        so_luong:       r.so_luong,
      }));
    }

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, group_by: groupBy },
      tong_activity: tongActivity,
      summary,
      data: trendData,
    });
  } catch (err) {
    console.error('[GET /activity/stats/by-type-over-time]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. GET /api/activity/stats/by-sales-rep
//    Số activity theo sales rep (nhân viên phụ trách)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/activity/stats/by-sales-rep:
 *   get:
 *     summary: "Số activity theo sales rep"
 *     description: |
 *       Thống kê số lượng hoạt động (Activity) theo từng nhân viên phụ trách (`Activity.NguoiTaoId` hoặc `NguoiXuLyId`).
 *       - Đếm tổng số activity và phân loại theo `LoaiHoatDong` cho từng sales rep.
 *       - Lọc ngày theo `Activity.NgayTao`.
 *       - Hỗ trợ `group_by` để xem xu hướng theo ngày / tuần / tháng cho từng nhân viên.
 *     tags: [Activity]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/actDateFrom'
 *       - $ref: '#/components/parameters/actDateTo'
 *       - $ref: '#/components/parameters/actGroupBy'
 *     responses:
 *       200:
 *         description: Thống kê activity theo sales rep
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_activity: { type: integer, description: "Tổng số activity trong khoảng lọc" }
 *                 summary:
 *                   type: array
 *                   description: Tổng hợp theo sales rep
 *                   items:
 *                     type: object
 *                     properties:
 *                       sales_rep_id:    { type: string }
 *                       FullName:        { type: string }
 *                       UserName:        { type: string }
 *                       tong_activity:   { type: integer }
 *                       ti_le_phan_tram: { type: number }
 *                 data:
 *                   type: array
 *                   description: Xu hướng theo kỳ và sales rep (chỉ có khi truyền group_by)
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:        { type: string }
 *                       sales_rep_id:  { type: string }
 *                       FullName:      { type: string }
 *                       UserName:      { type: string }
 *                       tong_activity: { type: integer }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/by-sales-rep', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || null;

    const dateExtra = buildDateWhere('a', 'NgayTao', { dateFrom, dateTo });

    // ── Summary: tổng theo sales rep ─────────────────────────────────────────
    const reqSum = pool.request();
    addDateParams(reqSum, { dateFrom, dateTo });

    const sumResult = await reqSum.query(`
      SELECT
        a.NguoiTaoId                                AS sales_rep_id,
        ISNULL(u.FullName, N'Chưa phân công')       AS FullName,
        ISNULL(u.UserName, '')                      AS UserName,
        COUNT(a.Id)                                 AS tong_activity
      FROM dbo.Activity a
      LEFT JOIN dbo.[UserFunction] u
        ON u.UserId = a.NguoiTaoId
      WHERE a.TrangThai = 1
        ${dateExtra}
      GROUP BY a.NguoiTaoId, u.FullName, u.UserName
      ORDER BY tong_activity DESC
    `);

    const tongActivity = sumResult.recordset.reduce((s, r) => s + (r.tong_activity || 0), 0);

    const summary = sumResult.recordset.map(r => ({
      sales_rep_id:    r.sales_rep_id,
      FullName:        r.FullName,
      UserName:        r.UserName,
      tong_activity:   r.tong_activity,
      ti_le_phan_tram: tongActivity > 0
        ? parseFloat(((r.tong_activity / tongActivity) * 100).toFixed(2))
        : 0,
    }));

    // ── Xu hướng theo kỳ + sales rep ─────────────────────────────────────────
    let trendData = [];
    if (groupBy) {
      const periodExpr = buildPeriodExpr('a', 'NgayTao', groupBy);
      const reqTrend   = pool.request();
      addDateParams(reqTrend, { dateFrom, dateTo });

      const trendResult = await reqTrend.query(`
        SELECT
          ${periodExpr}                                AS period,
          a.NguoiTaoId                                 AS sales_rep_id,
          ISNULL(u.FullName, N'Chưa phân công')        AS FullName,
          ISNULL(u.UserName, '')                       AS UserName,
          COUNT(a.Id)                                  AS tong_activity
        FROM dbo.Activity a
        LEFT JOIN dbo.[UserFunction] u
          ON u.UserId = a.NguoiTaoId
        WHERE a.TrangThai = 1
          ${dateExtra}
        GROUP BY ${periodExpr}, a.NguoiTaoId, u.FullName, u.UserName
        ORDER BY period ASC, tong_activity DESC
      `);

      trendData = trendResult.recordset.map(r => ({
        period:        r.period,
        sales_rep_id:  r.sales_rep_id,
        FullName:      r.FullName,
        UserName:      r.UserName,
        tong_activity: r.tong_activity,
      }));
    }

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, group_by: groupBy },
      tong_activity: tongActivity,
      summary,
      data: trendData,
    });
  } catch (err) {
    console.error('[GET /activity/stats/by-sales-rep]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. GET /api/activity/stats/avg-per-lead
//    Số activity trung bình trên mỗi Lead
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/activity/stats/avg-per-lead:
 *   get:
 *     summary: "Số activity trung bình per lead"
 *     description: |
 *       Tính số lượng hoạt động (Activity) trung bình được ghi nhận cho mỗi Lead.
 *       - **Cách tính**: đếm số Activity liên kết với mỗi Lead (qua `Activity.LeadId`), rồi lấy trung bình.
 *       - Chỉ tính các Lead đang hoạt động (`Lead.TrangThai = 1`).
 *       - Chỉ tính các Activity đang hoạt động (`Activity.TrangThai = 1`).
 *       - Lọc ngày theo `Lead.NgayTao`.
 *       - Hỗ trợ `group_by` để xem xu hướng trung bình theo kỳ thời gian.
 *
 *       Kết quả trả về:
 *       - `summary`: tổng Lead, tổng Activity, trung bình activity/lead.
 *       - `data`: phân bổ theo kỳ thời gian (chỉ có khi truyền `group_by`).
 *     tags: [Activity]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/actDateFrom'
 *       - $ref: '#/components/parameters/actDateTo'
 *       - $ref: '#/components/parameters/actGroupBy'
 *     responses:
 *       200:
 *         description: Số activity trung bình per lead
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
 *                     tong_lead:         { type: integer, description: "Tổng số Lead trong khoảng lọc" }
 *                     tong_activity:     { type: integer, description: "Tổng số Activity liên kết" }
 *                     tb_activity_per_lead: { type: number, description: "Trung bình số activity trên mỗi lead" }
 *                 data:
 *                   type: array
 *                   description: Xu hướng theo kỳ (chỉ có khi truyền group_by)
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:               { type: string }
 *                       tong_lead:            { type: integer }
 *                       tong_activity:        { type: integer }
 *                       tb_activity_per_lead: { type: number }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/avg-per-lead', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || null;

    const dateExtra = buildDateWhere('l', 'NgayTao', { dateFrom, dateTo });

    // ── Summary ───────────────────────────────────────────────────────────────
    const reqSum = pool.request();
    addDateParams(reqSum, { dateFrom, dateTo });

    const sumResult = await reqSum.query(`
      SELECT
        COUNT(DISTINCT l.Id)   AS tong_lead,
        COUNT(a.Id)            AS tong_activity
      FROM dbo.Lead l
      LEFT JOIN dbo.Activity a
        ON a.LeadId = l.Id AND a.TrangThai = 1
      WHERE l.TrangThai = 1
        ${dateExtra}
    `);

    const s = sumResult.recordset[0];
    const summary = {
      tong_lead:            s.tong_lead,
      tong_activity:        s.tong_activity,
      tb_activity_per_lead: s.tong_lead > 0
        ? parseFloat((s.tong_activity / s.tong_lead).toFixed(2))
        : 0,
    };

    // ── Xu hướng theo kỳ ─────────────────────────────────────────────────────
    let trendData = [];
    if (groupBy) {
      const periodExpr = buildPeriodExpr('l', 'NgayTao', groupBy);
      const reqTrend   = pool.request();
      addDateParams(reqTrend, { dateFrom, dateTo });

      const trendResult = await reqTrend.query(`
        SELECT
          ${periodExpr}              AS period,
          COUNT(DISTINCT l.Id)       AS tong_lead,
          COUNT(a.Id)                AS tong_activity
        FROM dbo.Lead l
        LEFT JOIN dbo.Activity a
          ON a.LeadId = l.Id AND a.TrangThai = 1
        WHERE l.TrangThai = 1
          ${dateExtra}
        GROUP BY ${periodExpr}
        ORDER BY period ASC
      `);

      trendData = trendResult.recordset.map(r => ({
        period:               r.period,
        tong_lead:            r.tong_lead,
        tong_activity:        r.tong_activity,
        tb_activity_per_lead: r.tong_lead > 0
          ? parseFloat((r.tong_activity / r.tong_lead).toFixed(2))
          : 0,
      }));
    }

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, group_by: groupBy },
      summary,
      data: trendData,
    });
  } catch (err) {
    console.error('[GET /activity/stats/avg-per-lead]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. GET /api/activity/stats/first-response-time
//    Thời gian phản hồi trung bình từ lúc tạo Lead đến Activity đầu tiên
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/activity/stats/first-response-time:
 *   get:
 *     summary: "Thời gian phản hồi trung bình: Lead → Activity đầu tiên"
 *     description: |
 *       Tính thời gian trung bình (giờ) từ khi Lead được tạo (`Lead.NgayTao`) đến khi Activity đầu tiên
 *       được ghi nhận cho Lead đó (`MIN(Activity.NgayTao)`).
 *       - Chỉ tính các Lead đã có ít nhất 1 Activity liên kết.
 *       - Loại bỏ các trường hợp Activity xảy ra **trước** ngày tạo Lead (dữ liệu lỗi).
 *       - Lọc ngày theo `Lead.NgayTao`.
 *       - Hỗ trợ `group_by` để xem xu hướng thời gian phản hồi theo kỳ.
 *
 *       Đơn vị trả về: **giờ** (`gio`) và **phút** (`phut`) để tiện sử dụng.
 *     tags: [Activity]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/actDateFrom'
 *       - $ref: '#/components/parameters/actDateTo'
 *       - $ref: '#/components/parameters/actGroupBy'
 *     responses:
 *       200:
 *         description: Thời gian phản hồi trung bình Lead → Activity đầu tiên
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
 *                     tong_lead_co_activity:  { type: integer, description: "Số Lead đã có Activity" }
 *                     tb_phan_hoi_gio:        { type: number,  description: "Thời gian phản hồi TB (giờ)" }
 *                     tb_phan_hoi_phut:       { type: number,  description: "Thời gian phản hồi TB (phút)" }
 *                 data:
 *                   type: array
 *                   description: Xu hướng theo kỳ (chỉ có khi truyền group_by)
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:              { type: string }
 *                       tong_lead_co_activity: { type: integer }
 *                       tb_phan_hoi_gio:     { type: number }
 *                       tb_phan_hoi_phut:    { type: number }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/first-response-time', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || null;

    const dateExtra = buildDateWhere('l', 'NgayTao', { dateFrom, dateTo });

    // ── Summary ───────────────────────────────────────────────────────────────
    const reqSum = pool.request();
    addDateParams(reqSum, { dateFrom, dateTo });

    const sumResult = await reqSum.query(`
      SELECT
        COUNT(*)                                            AS tong_lead_co_activity,
        AVG(CAST(phut_phan_hoi AS FLOAT))                  AS tb_phut
      FROM (
        SELECT
          l.Id,
          DATEDIFF(MINUTE, l.NgayTao, MIN(a.NgayTao))      AS phut_phan_hoi
        FROM dbo.Lead l
        INNER JOIN dbo.Activity a
          ON a.LeadId = l.Id AND a.TrangThai = 1
             AND a.NgayTao >= l.NgayTao
        WHERE l.TrangThai = 1
          ${dateExtra}
        GROUP BY l.Id, l.NgayTao
      ) AS sub
    `);

    const s = sumResult.recordset[0];
    const tbPhut = s.tb_phut != null ? parseFloat(s.tb_phut.toFixed(1)) : null;
    const summary = {
      tong_lead_co_activity: s.tong_lead_co_activity,
      tb_phan_hoi_gio:       tbPhut != null ? parseFloat((tbPhut / 60).toFixed(2)) : null,
      tb_phan_hoi_phut:      tbPhut,
    };

    // ── Xu hướng theo kỳ ─────────────────────────────────────────────────────
    let trendData = [];
    if (groupBy) {
      const periodExpr = buildPeriodExpr('l', 'NgayTao', groupBy);
      const reqTrend   = pool.request();
      addDateParams(reqTrend, { dateFrom, dateTo });

      const trendResult = await reqTrend.query(`
        SELECT
          period,
          COUNT(*)                                          AS tong_lead_co_activity,
          AVG(CAST(phut_phan_hoi AS FLOAT))                AS tb_phut
        FROM (
          SELECT
            l.Id,
            ${periodExpr}                                   AS period,
            DATEDIFF(MINUTE, l.NgayTao, MIN(a.NgayTao))    AS phut_phan_hoi
          FROM dbo.Lead l
          INNER JOIN dbo.Activity a
            ON a.LeadId = l.Id AND a.TrangThai = 1
               AND a.NgayTao >= l.NgayTao
          WHERE l.TrangThai = 1
            ${dateExtra}
          GROUP BY l.Id, l.NgayTao, ${periodExpr}
        ) AS sub
        GROUP BY period
        ORDER BY period ASC
      `);

      trendData = trendResult.recordset.map(r => {
        const phut = r.tb_phut != null ? parseFloat(r.tb_phut.toFixed(1)) : null;
        return {
          period:                r.period,
          tong_lead_co_activity: r.tong_lead_co_activity,
          tb_phan_hoi_gio:       phut != null ? parseFloat((phut / 60).toFixed(2)) : null,
          tb_phan_hoi_phut:      phut,
        };
      });
    }

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, group_by: groupBy },
      summary,
      data: trendData,
    });
  } catch (err) {
    console.error('[GET /activity/stats/first-response-time]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
