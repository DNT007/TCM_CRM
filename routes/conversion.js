const express = require('express');
const router  = express.Router();
const { sql, getPool } = require('../db');

/**
 * @swagger
 * tags:
 *   name: Conversion
 *   description: Tỉ lệ chuyển đổi trong phễu bán hàng (Lead → Cơ hội → Báo giá → Đơn hàng)
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

// ─── Shared Swagger date params ────────────────────────────────────────────────
/**
 * @swagger
 * components:
 *   parameters:
 *     convDateFrom:
 *       in: query
 *       name: date_from
 *       schema: { type: string, format: date }
 *       description: Lọc từ ngày (yyyy-MM-dd)
 *       example: "2024-01-01"
 *     convDateTo:
 *       in: query
 *       name: date_to
 *       schema: { type: string, format: date }
 *       description: Lọc đến ngày (yyyy-MM-dd)
 *       example: "2024-12-31"
 *     convGroupBy:
 *       in: query
 *       name: group_by
 *       description: Nhóm theo thời gian (để trống = chỉ trả tổng hợp)
 *       schema: { type: string, enum: [day, week, month] }
 */

function buildPeriodExpr(alias, col, groupBy) {
  const c = `${alias}.${col}`;
  if (groupBy === 'day')  return `FORMAT(${c}, 'yyyy-MM-dd')`;
  if (groupBy === 'week') return `CONCAT(YEAR(${c}), '-W', RIGHT('00' + CAST(DATEPART(isowk, ${c}) AS VARCHAR(2)), 2))`;
  return `FORMAT(${c}, 'yyyy-MM')`;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. GET /api/conversion/lead-to-opportunity
//    Tỉ lệ Lead → Cơ hội
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/conversion/lead-to-opportunity:
 *   get:
 *     summary: "Tỉ lệ chuyển đổi Lead → Cơ hội"
 *     description: |
 *       Tính tỉ lệ % số Lead được chuyển thành Cơ hội (Opportunity).
 *       - **Tổng Lead**: đếm tất cả Lead có TrangThai = 1 trong khoảng thời gian lọc.
 *       - **Lead chuyển đổi**: đếm Lead đã có ít nhất 1 Opportunity liên kết (Opportunity.LeadId = Lead.Id).
 *       - **Tỉ lệ**: `(lead_da_chuyen / tong_lead) * 100` (%).
 *
 *       Hỗ trợ `group_by` để xem xu hướng theo kỳ thời gian.
 *     tags: [Conversion]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/convDateFrom'
 *       - $ref: '#/components/parameters/convDateTo'
 *       - $ref: '#/components/parameters/convGroupBy'
 *     responses:
 *       200:
 *         description: Tỉ lệ chuyển đổi Lead → Cơ hội
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
 *                     tong_lead:        { type: integer, description: "Tổng số Lead" }
 *                     lead_da_chuyen:   { type: integer, description: "Lead đã tạo ít nhất 1 Cơ hội" }
 *                     ti_le_phan_tram:  { type: number,  description: "Tỉ lệ chuyển đổi (%)" }
 *                 data:
 *                   type: array
 *                   description: Xu hướng theo kỳ (chỉ có khi truyền group_by)
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:           { type: string }
 *                       tong_lead:        { type: integer }
 *                       lead_da_chuyen:   { type: integer }
 *                       ti_le_phan_tram:  { type: number }
 *       500:
 *         description: Lỗi server
 */
router.get('/lead-to-opportunity', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || null;

    const dateExtra = buildDateWhere('l', 'NgayTao', { dateFrom, dateTo });

    // ── Summary ──────────────────────────────────────────────────────────────
    const reqSum = pool.request();
    addDateParams(reqSum, { dateFrom, dateTo });

    const sumResult = await reqSum.query(`
      SELECT
        COUNT(l.Id)                                               AS tong_lead,
        COUNT(DISTINCT o.LeadId)                                  AS lead_da_chuyen
      FROM dbo.Lead l
      LEFT JOIN dbo.Opportunity o
        ON o.LeadId = l.Id AND o.TrangThai = 1
      WHERE l.TrangThai = 1
        ${dateExtra}
    `);

    const s = sumResult.recordset[0];
    const summary = {
      tong_lead:       s.tong_lead,
      lead_da_chuyen:  s.lead_da_chuyen,
      ti_le_phan_tram: s.tong_lead > 0
        ? parseFloat(((s.lead_da_chuyen / s.tong_lead) * 100).toFixed(2))
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
          ${periodExpr}            AS period,
          COUNT(l.Id)              AS tong_lead,
          COUNT(DISTINCT o.LeadId) AS lead_da_chuyen
        FROM dbo.Lead l
        LEFT JOIN dbo.Opportunity o
          ON o.LeadId = l.Id AND o.TrangThai = 1
        WHERE l.TrangThai = 1
          ${dateExtra}
        GROUP BY ${periodExpr}
        ORDER BY period ASC
      `);

      trendData = trendResult.recordset.map(r => ({
        period:          r.period,
        tong_lead:       r.tong_lead,
        lead_da_chuyen:  r.lead_da_chuyen,
        ti_le_phan_tram: r.tong_lead > 0
          ? parseFloat(((r.lead_da_chuyen / r.tong_lead) * 100).toFixed(2))
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
    console.error('[GET /conversion/lead-to-opportunity]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. GET /api/conversion/opportunity-to-quotation
//    Tỉ lệ Cơ hội → Báo giá
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/conversion/opportunity-to-quotation:
 *   get:
 *     summary: "Tỉ lệ chuyển đổi Cơ hội → Báo giá"
 *     description: |
 *       Tính tỉ lệ % số Cơ hội được chuyển thành Báo giá (Quotation).
 *       - **Tổng Cơ hội**: đếm Opportunity có TrangThai = 1 trong khoảng thời gian lọc.
 *       - **Cơ hội có Báo giá**: đếm Opportunity đã có ít nhất 1 Quotation liên kết (Quotation.OpportunityId = Opportunity.Id).
 *       - **Tỉ lệ**: `(co_hoi_da_bao_gia / tong_co_hoi) * 100` (%).
 *
 *       Hỗ trợ `group_by` để xem xu hướng theo kỳ thời gian.
 *     tags: [Conversion]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/convDateFrom'
 *       - $ref: '#/components/parameters/convDateTo'
 *       - $ref: '#/components/parameters/convGroupBy'
 *     responses:
 *       200:
 *         description: Tỉ lệ chuyển đổi Cơ hội → Báo giá
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
 *                     tong_co_hoi:         { type: integer, description: "Tổng số Cơ hội" }
 *                     co_hoi_da_bao_gia:   { type: integer, description: "Cơ hội đã có ít nhất 1 Báo giá" }
 *                     ti_le_phan_tram:     { type: number,  description: "Tỉ lệ chuyển đổi (%)" }
 *                 data:
 *                   type: array
 *                   description: Xu hướng theo kỳ (chỉ có khi truyền group_by)
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:            { type: string }
 *                       tong_co_hoi:       { type: integer }
 *                       co_hoi_da_bao_gia: { type: integer }
 *                       ti_le_phan_tram:   { type: number }
 *       500:
 *         description: Lỗi server
 */
router.get('/opportunity-to-quotation', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || null;

    const dateExtra = buildDateWhere('op', 'NgayTao', { dateFrom, dateTo });

    // ── Summary ──────────────────────────────────────────────────────────────
    const reqSum = pool.request();
    addDateParams(reqSum, { dateFrom, dateTo });

    const sumResult = await reqSum.query(`
      SELECT
        COUNT(op.Id)                  AS tong_co_hoi,
        COUNT(DISTINCT q.OpportunityId) AS co_hoi_da_bao_gia
      FROM dbo.Opportunity op
      LEFT JOIN dbo.Quotation q
        ON q.OpportunityId = op.Id AND q.TrangThai != 0
      WHERE op.TrangThai = 1
        ${dateExtra}
    `);

    const s = sumResult.recordset[0];
    const summary = {
      tong_co_hoi:       s.tong_co_hoi,
      co_hoi_da_bao_gia: s.co_hoi_da_bao_gia,
      ti_le_phan_tram:   s.tong_co_hoi > 0
        ? parseFloat(((s.co_hoi_da_bao_gia / s.tong_co_hoi) * 100).toFixed(2))
        : 0,
    };

    // ── Xu hướng theo kỳ ─────────────────────────────────────────────────────
    let trendData = [];
    if (groupBy) {
      const periodExpr = buildPeriodExpr('op', 'NgayTao', groupBy);
      const reqTrend   = pool.request();
      addDateParams(reqTrend, { dateFrom, dateTo });

      const trendResult = await reqTrend.query(`
        SELECT
          ${periodExpr}                    AS period,
          COUNT(op.Id)                     AS tong_co_hoi,
          COUNT(DISTINCT q.OpportunityId)  AS co_hoi_da_bao_gia
        FROM dbo.Opportunity op
        LEFT JOIN dbo.Quotation q
          ON q.OpportunityId = op.Id AND q.TrangThai != 0
        WHERE op.TrangThai = 1
          ${dateExtra}
        GROUP BY ${periodExpr}
        ORDER BY period ASC
      `);

      trendData = trendResult.recordset.map(r => ({
        period:            r.period,
        tong_co_hoi:       r.tong_co_hoi,
        co_hoi_da_bao_gia: r.co_hoi_da_bao_gia,
        ti_le_phan_tram:   r.tong_co_hoi > 0
          ? parseFloat(((r.co_hoi_da_bao_gia / r.tong_co_hoi) * 100).toFixed(2))
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
    console.error('[GET /conversion/opportunity-to-quotation]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. GET /api/conversion/quotation-to-order
//    Tỉ lệ Báo giá → Đơn hàng (Win Rate)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/conversion/quotation-to-order:
 *   get:
 *     summary: "Tỉ lệ Báo giá → Đơn hàng (Win Rate)"
 *     description: |
 *       Tính Win Rate – tỉ lệ % số Báo giá được chuyển thành Đơn hàng thực tế.
 *       - **Tổng Báo giá**: đếm Quotation có TrangThai != 0 trong khoảng thời gian lọc.
 *       - **Báo giá thành đơn**: đếm Quotation đã có ít nhất 1 Order liên kết (Order.SoHopDong = Quotation.SoHopDong).
 *       - **Win Rate**: `(bao_gia_thanh_don / tong_bao_gia) * 100` (%).
 *
 *       Lọc ngày dựa trên `Quotation.NgayTao`. Hỗ trợ `group_by` để xem xu hướng theo kỳ.
 *     tags: [Conversion]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/convDateFrom'
 *       - $ref: '#/components/parameters/convDateTo'
 *       - $ref: '#/components/parameters/convGroupBy'
 *     responses:
 *       200:
 *         description: Win Rate – tỉ lệ Báo giá → Đơn hàng
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
 *                     tong_bao_gia:        { type: integer, description: "Tổng số Báo giá" }
 *                     bao_gia_thanh_don:   { type: integer, description: "Báo giá đã tạo được Đơn hàng" }
 *                     win_rate_phan_tram:  { type: number,  description: "Win Rate (%)" }
 *                 data:
 *                   type: array
 *                   description: Xu hướng theo kỳ (chỉ có khi truyền group_by)
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:             { type: string }
 *                       tong_bao_gia:       { type: integer }
 *                       bao_gia_thanh_don:  { type: integer }
 *                       win_rate_phan_tram: { type: number }
 *       500:
 *         description: Lỗi server
 */
router.get('/quotation-to-order', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || null;

    const dateExtra = buildDateWhere('q', 'NgayTao', { dateFrom, dateTo });

    // ── Summary ──────────────────────────────────────────────────────────────
    const reqSum = pool.request();
    addDateParams(reqSum, { dateFrom, dateTo });

    const sumResult = await reqSum.query(`
      SELECT
        COUNT(q.Id)                   AS tong_bao_gia,
        COUNT(DISTINCT o.SoHopDong)   AS bao_gia_thanh_don
      FROM dbo.Quotation q
      LEFT JOIN dbo.[Order] o
        ON o.SoHopDong = q.SoHopDong AND o.TrangThai = 1
      WHERE q.TrangThai != 0
        ${dateExtra}
    `);

    const s = sumResult.recordset[0];
    const summary = {
      tong_bao_gia:       s.tong_bao_gia,
      bao_gia_thanh_don:  s.bao_gia_thanh_don,
      win_rate_phan_tram: s.tong_bao_gia > 0
        ? parseFloat(((s.bao_gia_thanh_don / s.tong_bao_gia) * 100).toFixed(2))
        : 0,
    };

    // ── Xu hướng theo kỳ ─────────────────────────────────────────────────────
    let trendData = [];
    if (groupBy) {
      const periodExpr = buildPeriodExpr('q', 'NgayTao', groupBy);
      const reqTrend   = pool.request();
      addDateParams(reqTrend, { dateFrom, dateTo });

      const trendResult = await reqTrend.query(`
        SELECT
          ${periodExpr}                   AS period,
          COUNT(q.Id)                     AS tong_bao_gia,
          COUNT(DISTINCT o.SoHopDong)     AS bao_gia_thanh_don
        FROM dbo.Quotation q
        LEFT JOIN dbo.[Order] o
          ON o.SoHopDong = q.SoHopDong AND o.TrangThai = 1
        WHERE q.TrangThai != 0
          ${dateExtra}
        GROUP BY ${periodExpr}
        ORDER BY period ASC
      `);

      trendData = trendResult.recordset.map(r => ({
        period:             r.period,
        tong_bao_gia:       r.tong_bao_gia,
        bao_gia_thanh_don:  r.bao_gia_thanh_don,
        win_rate_phan_tram: r.tong_bao_gia > 0
          ? parseFloat(((r.bao_gia_thanh_don / r.tong_bao_gia) * 100).toFixed(2))
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
    console.error('[GET /conversion/quotation-to-order]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. GET /api/conversion/lead-to-order
//    Tỉ lệ chuyển đổi end-to-end: Lead → Đơn hàng
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/conversion/lead-to-order:
 *   get:
 *     summary: "Tỉ lệ chuyển đổi end-to-end: Lead → Đơn hàng"
 *     description: |
 *       Tính tỉ lệ % số Lead cuối cùng trở thành Đơn hàng (toàn bộ phễu).
 *       - **Tổng Lead**: đếm Lead có TrangThai = 1 trong khoảng thời gian lọc.
 *       - **Lead thành đơn**: đếm Lead đã có chuỗi Lead → Opportunity → Quotation → Order thành công.
 *         Chain: `Lead → Opportunity.LeadId → Quotation.OpportunityId → Order.SoHopDong = Quotation.SoHopDong`.
 *       - **Tỉ lệ**: `(lead_thanh_don / tong_lead) * 100` (%).
 *
 *       Hỗ trợ `group_by` để xem xu hướng theo kỳ thời gian.
 *     tags: [Conversion]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/convDateFrom'
 *       - $ref: '#/components/parameters/convDateTo'
 *       - $ref: '#/components/parameters/convGroupBy'
 *     responses:
 *       200:
 *         description: Tỉ lệ chuyển đổi end-to-end Lead → Đơn hàng
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
 *                     tong_lead:       { type: integer, description: "Tổng số Lead" }
 *                     lead_thanh_don:  { type: integer, description: "Lead đã trở thành Đơn hàng" }
 *                     ti_le_phan_tram: { type: number,  description: "Tỉ lệ end-to-end (%)" }
 *                 data:
 *                   type: array
 *                   description: Xu hướng theo kỳ (chỉ có khi truyền group_by)
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:          { type: string }
 *                       tong_lead:       { type: integer }
 *                       lead_thanh_don:  { type: integer }
 *                       ti_le_phan_tram: { type: number }
 *       500:
 *         description: Lỗi server
 */
router.get('/lead-to-order', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || null;

    const dateExtra = buildDateWhere('l', 'NgayTao', { dateFrom, dateTo });

    // ── Summary ──────────────────────────────────────────────────────────────
    const reqSum = pool.request();
    addDateParams(reqSum, { dateFrom, dateTo });

    const sumResult = await reqSum.query(`
      SELECT
        COUNT(l.Id)              AS tong_lead,
        COUNT(DISTINCT l.Id
          -- chỉ đếm lead nào cuối cùng có Order
        )                        AS tong_lead_raw,
        SUM(CASE WHEN ord.Id IS NOT NULL THEN 1 ELSE 0 END) AS lead_thanh_don
      FROM dbo.Lead l
      LEFT JOIN dbo.Opportunity op
        ON op.LeadId = l.Id AND op.TrangThai = 1
      LEFT JOIN dbo.Quotation q
        ON q.OpportunityId = op.Id AND q.TrangThai != 0
      LEFT JOIN dbo.[Order] ord
        ON ord.SoHopDong = q.SoHopDong AND ord.TrangThai = 1
      WHERE l.TrangThai = 1
        ${dateExtra}
    `);

    // Dùng subquery COUNT(DISTINCT) để tránh duplicate từ multiple joins
    const reqSum2 = pool.request();
    addDateParams(reqSum2, { dateFrom, dateTo });
    const sumResult2 = await reqSum2.query(`
      SELECT
        COUNT(*)           AS tong_lead,
        SUM(has_order)     AS lead_thanh_don
      FROM (
        SELECT
          l.Id,
          MAX(CASE WHEN ord.Id IS NOT NULL THEN 1 ELSE 0 END) AS has_order
        FROM dbo.Lead l
        LEFT JOIN dbo.Opportunity op
          ON op.LeadId = l.Id AND op.TrangThai = 1
        LEFT JOIN dbo.Quotation q
          ON q.OpportunityId = op.Id AND q.TrangThai != 0
        LEFT JOIN dbo.[Order] ord
          ON ord.SoHopDong = q.SoHopDong AND ord.TrangThai = 1
        WHERE l.TrangThai = 1
          ${dateExtra}
        GROUP BY l.Id
      ) AS sub
    `);

    const s = sumResult2.recordset[0];
    const summary = {
      tong_lead:       s.tong_lead,
      lead_thanh_don:  s.lead_thanh_don,
      ti_le_phan_tram: s.tong_lead > 0
        ? parseFloat(((s.lead_thanh_don / s.tong_lead) * 100).toFixed(2))
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
          period,
          COUNT(*)        AS tong_lead,
          SUM(has_order)  AS lead_thanh_don
        FROM (
          SELECT
            l.Id,
            ${periodExpr}                                              AS period,
            MAX(CASE WHEN ord.Id IS NOT NULL THEN 1 ELSE 0 END)       AS has_order
          FROM dbo.Lead l
          LEFT JOIN dbo.Opportunity op
            ON op.LeadId = l.Id AND op.TrangThai = 1
          LEFT JOIN dbo.Quotation q
            ON q.OpportunityId = op.Id AND q.TrangThai != 0
          LEFT JOIN dbo.[Order] ord
            ON ord.SoHopDong = q.SoHopDong AND ord.TrangThai = 1
          WHERE l.TrangThai = 1
            ${dateExtra}
          GROUP BY l.Id, ${periodExpr}
        ) AS sub
        GROUP BY period
        ORDER BY period ASC
      `);

      trendData = trendResult.recordset.map(r => ({
        period:          r.period,
        tong_lead:       r.tong_lead,
        lead_thanh_don:  r.lead_thanh_don,
        ti_le_phan_tram: r.tong_lead > 0
          ? parseFloat(((r.lead_thanh_don / r.tong_lead) * 100).toFixed(2))
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
    console.error('[GET /conversion/lead-to-order]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. GET /api/conversion/win-rate-by-sales-rep
//    Win Rate theo sales rep (người phụ trách Cơ hội)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/conversion/win-rate-by-sales-rep:
 *   get:
 *     summary: "Win Rate theo sales rep"
 *     description: |
 *       Tỉ lệ % Báo giá chuyển thành Đơn hàng phân tách theo từng nhân viên phụ trách Cơ hội (`Opportunity.NguoiXuLyId`).
 *       - **Tổng Báo giá**: mỗi Quotation liên kết qua `Quotation.OpportunityId → Opportunity.NguoiXuLyId`.
 *       - **Báo giá thành đơn**: Quotation đã có `Order.SoHopDong = Quotation.SoHopDong`.
 *       - **Win Rate**: `(bao_gia_thanh_don / tong_bao_gia) * 100` (%).
 *
 *       Lọc ngày theo `Quotation.NgayTao`.
 *     tags: [Conversion]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/convDateFrom'
 *       - $ref: '#/components/parameters/convDateTo'
 *     responses:
 *       200:
 *         description: Win Rate theo từng nhân viên phụ trách
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_bao_gia:       { type: integer }
 *                 tong_bao_gia_thanh_don: { type: integer }
 *                 win_rate_tong:      { type: number, description: "Win Rate tổng (%)" }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       sales_rep_id:      { type: string }
 *                       FullName:          { type: string }
 *                       UserName:          { type: string }
 *                       tong_bao_gia:      { type: integer }
 *                       bao_gia_thanh_don: { type: integer }
 *                       win_rate_phan_tram: { type: number, description: "Win Rate (%)" }
 *       500:
 *         description: Lỗi server
 */
router.get('/win-rate-by-sales-rep', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const dateExtra = buildDateWhere('q', 'NgayTao', { dateFrom, dateTo });

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });

    const result = await request.query(`
      SELECT
        op.NguoiXuLyId                                        AS sales_rep_id,
        ISNULL(u.FullName, N'Chưa phân công')                AS FullName,
        ISNULL(u.UserName, '')                                AS UserName,
        COUNT(q.Id)                                           AS tong_bao_gia,
        COUNT(DISTINCT CASE WHEN ord.Id IS NOT NULL
              THEN q.SoHopDong END)                          AS bao_gia_thanh_don
      FROM dbo.Quotation q
      LEFT JOIN dbo.Opportunity op
        ON op.Id = q.OpportunityId AND op.TrangThai = 1
      LEFT JOIN dbo.[UserFunction] u
        ON u.UserId = op.NguoiXuLyId
      LEFT JOIN dbo.[Order] ord
        ON ord.SoHopDong = q.SoHopDong AND ord.TrangThai = 1
      WHERE q.TrangThai != 0
        ${dateExtra}
      GROUP BY op.NguoiXuLyId, u.FullName, u.UserName
      ORDER BY bao_gia_thanh_don DESC
    `);

    const tongBaoGia       = result.recordset.reduce((s, r) => s + (r.tong_bao_gia      || 0), 0);
    const tongBaoGiaThanhDon = result.recordset.reduce((s, r) => s + (r.bao_gia_thanh_don || 0), 0);

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      tong_bao_gia:            tongBaoGia,
      tong_bao_gia_thanh_don:  tongBaoGiaThanhDon,
      win_rate_tong: tongBaoGia > 0
        ? parseFloat(((tongBaoGiaThanhDon / tongBaoGia) * 100).toFixed(2))
        : 0,
      data: result.recordset.map(r => ({
        sales_rep_id:      r.sales_rep_id,
        FullName:          r.FullName,
        UserName:          r.UserName,
        tong_bao_gia:      r.tong_bao_gia,
        bao_gia_thanh_don: r.bao_gia_thanh_don,
        win_rate_phan_tram: r.tong_bao_gia > 0
          ? parseFloat(((r.bao_gia_thanh_don / r.tong_bao_gia) * 100).toFixed(2))
          : 0,
      })),
    });
  } catch (err) {
    console.error('[GET /conversion/win-rate-by-sales-rep]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. GET /api/conversion/win-rate-by-product
//    Win Rate theo sản phẩm / nhóm sản phẩm
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/conversion/win-rate-by-product:
 *   get:
 *     summary: "Win Rate theo sản phẩm / nhóm sản phẩm"
 *     description: |
 *       Tỉ lệ % Báo giá chuyển thành Đơn hàng, phân tách theo sản phẩm hoặc nhóm sản phẩm.
 *       - **Tổng Báo giá** (có chứa sản phẩm đó): số Quotation có LineItem sản phẩm đó.
 *       - **Báo giá thành đơn**: Quotation đã có `Order.SoHopDong = Quotation.SoHopDong`.
 *       - **Win Rate**: `(bao_gia_thanh_don / tong_bao_gia) * 100` (%).
 *
 *       Tham số `level`:
 *       - `group` (mặc định): nhóm theo **danh mục sản phẩm cấp cha** (Taxonomy)
 *       - `subgroup`: nhóm theo **danh mục sản phẩm cấp con**
 *       - `product`: nhóm theo **từng sản phẩm** cụ thể
 *
 *       Join chain: `Quotation → LinkQuotationProduct → Product → Taxonomy`.
 *       Lọc ngày theo `Quotation.NgayTao`.
 *     tags: [Conversion]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/convDateFrom'
 *       - $ref: '#/components/parameters/convDateTo'
 *       - in: query
 *         name: level
 *         description: "Mức phân tích: product | group | subgroup"
 *         schema: { type: string, enum: [product, group, subgroup], default: group }
 *     responses:
 *       200:
 *         description: Win Rate theo sản phẩm / nhóm sản phẩm
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_bao_gia:           { type: integer }
 *                 tong_bao_gia_thanh_don: { type: integer }
 *                 win_rate_tong:          { type: number, description: "Win Rate tổng (%)" }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:                { type: integer }
 *                       ten:               { type: string }
 *                       nhom_cha_id:       { type: integer, description: "Chỉ có ở level=subgroup" }
 *                       ten_nhom_cha:      { type: string,  description: "Chỉ có ở level=subgroup" }
 *                       ma_hang:           { type: string,  description: "Chỉ có ở level=product" }
 *                       tong_bao_gia:      { type: integer }
 *                       bao_gia_thanh_don: { type: integer }
 *                       win_rate_phan_tram: { type: number }
 *       500:
 *         description: Lỗi server
 */
router.get('/win-rate-by-product', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const level    = req.query.level     || 'group'; // product | group | subgroup

    const dateConds = ['q.TrangThai != 0'];
    if (dateFrom) dateConds.push('q.NgayTao >= @dateFrom');
    if (dateTo)   dateConds.push('q.NgayTao <= @dateTo');
    const whereClause = `WHERE ${dateConds.join(' AND ')}`;

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });

    // ── Build SELECT / GROUP BY tuỳ theo level ───────────────────────────────
    let selectDims, groupDims;

    if (level === 'product') {
      selectDims = `
        p.Id                                                  AS id,
        ISNULL(p.TenHang, N'(Không tên)')                    AS ten,
        p.MaHang                                              AS ma_hang`;
      groupDims = `p.Id, p.TenHang, p.MaHang`;
    } else if (level === 'subgroup') {
      selectDims = `
        tn.Id                                                 AS id,
        ISNULL(tn.TieuDe, N'(Chưa phân nhóm)')              AS ten,
        tnp.Id                                                AS nhom_cha_id,
        ISNULL(tnp.TieuDe, N'(Nhóm gốc)')                   AS ten_nhom_cha`;
      groupDims = `tn.Id, tn.TieuDe, tnp.Id, tnp.TieuDe`;
    } else {
      // group (mặc định): nhóm theo nhóm sản phẩm cấp cha
      selectDims = `
        ISNULL(tnp.Id,     tn.Id)                                        AS id,
        ISNULL(tnp.TieuDe, ISNULL(tn.TieuDe, N'(Chưa phân nhóm)'))    AS ten`;
      groupDims = `ISNULL(tnp.Id, tn.Id), ISNULL(tnp.TieuDe, tn.TieuDe)`;
    }

    const result = await request.query(`
      SELECT
        ${selectDims},
        COUNT(DISTINCT q.Id)                                           AS tong_bao_gia,
        COUNT(DISTINCT CASE WHEN ord.Id IS NOT NULL
              THEN q.SoHopDong END)                                   AS bao_gia_thanh_don
      FROM dbo.Quotation q
      INNER JOIN dbo.LinkQuotationProduct lqp ON lqp.QuotationId = q.Id
      INNER JOIN dbo.Product              p   ON p.Id = lqp.ProductId
      LEFT  JOIN dbo.Taxonomy             tn  ON tn.Id  = p.NhomThietBiId
      LEFT  JOIN dbo.Taxonomy             tnp ON tnp.Id = tn.KhoaChaId
      LEFT  JOIN dbo.[Order] ord
        ON ord.SoHopDong = q.SoHopDong AND ord.TrangThai = 1
      ${whereClause}
      GROUP BY ${groupDims}
      ORDER BY bao_gia_thanh_don DESC
    `);

    const tongBaoGia         = result.recordset.reduce((s, r) => s + (r.tong_bao_gia      || 0), 0);
    const tongBaoGiaThanhDon = result.recordset.reduce((s, r) => s + (r.bao_gia_thanh_don || 0), 0);

    const data = result.recordset.map(r => {
      const row = {
        id:                r.id,
        ten:               r.ten,
        tong_bao_gia:      r.tong_bao_gia,
        bao_gia_thanh_don: r.bao_gia_thanh_don,
        win_rate_phan_tram: r.tong_bao_gia > 0
          ? parseFloat(((r.bao_gia_thanh_don / r.tong_bao_gia) * 100).toFixed(2))
          : 0,
      };
      if (level === 'product')  { row.ma_hang     = r.ma_hang; }
      if (level === 'subgroup') { row.nhom_cha_id = r.nhom_cha_id; row.ten_nhom_cha = r.ten_nhom_cha; }
      return row;
    });

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, level },
      tong_bao_gia:            tongBaoGia,
      tong_bao_gia_thanh_don:  tongBaoGiaThanhDon,
      win_rate_tong: tongBaoGia > 0
        ? parseFloat(((tongBaoGiaThanhDon / tongBaoGia) * 100).toFixed(2))
        : 0,
      data,
    });
  } catch (err) {
    console.error('[GET /conversion/win-rate-by-product]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
