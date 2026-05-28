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
 *       Tính Win Rate – tỉ lệ % số Báo giá được chuyển thành Đơn hàng (Chốt thành công).
 *       Dựa trên trường `Quotation.TinhTrang`:
 *       - **1** = Nháp (Draft)
 *       - **2** = Đã gửi (Delivered)
 *       - **3** = Đã xác nhận (Confirmed)
 *       - **4** = **Thắng / Chốt (Close Won)** ← được tính là "thành đơn"
 *       - **5** = Thua / Từ chối (Close Lost)
 *
 *       - **Tổng Báo giá**: đếm Quotation có TrangThai != 0 trong khoảng thời gian lọc.
 *       - **Báo giá thành đơn**: đếm Quotation có `TinhTrang = 4` (Close Won).
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
 *                     bao_gia_thanh_don:   { type: integer, description: "TinhTrang=4 Close Won" }
 *                     bao_gia_thua:        { type: integer, description: "TinhTrang=5 Close Lost" }
 *                     bao_gia_xac_nhan:    { type: integer, description: "TinhTrang=3 Đã xác nhận" }
 *                     bao_gia_da_gui:      { type: integer, description: "TinhTrang=2 Đã gửi" }
 *                     bao_gia_nhap:        { type: integer, description: "TinhTrang=1 Nháp" }
 *                     win_rate_phan_tram:  { type: number,  description: "Win Rate trên đã có kết quả (%)" }
 *                     win_rate_toan_bo:    { type: number,  description: "Win Rate trên toàn bộ báo giá (%)" }
 *                 data:
 *                   type: array
 *                   description: Xu hướng theo kỳ (chỉ có khi truyền group_by)
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:             { type: string }
 *                       tong_bao_gia:       { type: integer }
 *                       bao_gia_thanh_don:  { type: integer, description: "TinhTrang=4" }
 *                       bao_gia_thua:       { type: integer, description: "TinhTrang=5" }
 *                       bao_gia_xac_nhan:   { type: integer, description: "TinhTrang=3" }
 *                       bao_gia_da_gui:     { type: integer, description: "TinhTrang=2" }
 *                       win_rate_phan_tram: { type: number }
 *                       win_rate_toan_bo:   { type: number }
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
        COUNT(q.Id)                                               AS tong_bao_gia,
        COUNT(CASE WHEN q.TinhTrang = 4 THEN 1 END)              AS bao_gia_thanh_don,  -- Close Won
        COUNT(CASE WHEN q.TinhTrang = 5 THEN 1 END)              AS bao_gia_thua,       -- Close Lost
        COUNT(CASE WHEN q.TinhTrang = 3 THEN 1 END)              AS bao_gia_xac_nhan,   -- Đã xác nhận
        COUNT(CASE WHEN q.TinhTrang = 2 THEN 1 END)              AS bao_gia_da_gui,     -- Đã gửi
        COUNT(CASE WHEN q.TinhTrang = 1 THEN 1 END)              AS bao_gia_nhap        -- Nháp
      FROM dbo.Quotation q
      WHERE q.TrangThai != 0
        ${dateExtra}
    `);

    const s = sumResult.recordset[0];
    const tongCoKetQua = (s.bao_gia_thanh_don || 0) + (s.bao_gia_thua || 0);
    const summary = {
      tong_bao_gia:        s.tong_bao_gia,
      bao_gia_thanh_don:   s.bao_gia_thanh_don,  // TinhTrang = 4 (Close Won)
      bao_gia_thua:        s.bao_gia_thua,        // TinhTrang = 5 (Close Lost)
      bao_gia_xac_nhan:    s.bao_gia_xac_nhan,   // TinhTrang = 3 (Đã xác nhận)
      bao_gia_da_gui:      s.bao_gia_da_gui,      // TinhTrang = 2 (Đã gửi)
      bao_gia_nhap:        s.bao_gia_nhap,         // TinhTrang = 1 (Nháp)
      // Win Rate tính trên tổng đã có kết quả (Close Won + Close Lost)
      win_rate_phan_tram: tongCoKetQua > 0
        ? parseFloat(((s.bao_gia_thanh_don / tongCoKetQua) * 100).toFixed(2))
        : 0,
      // Win Rate tính trên toàn bộ báo giá
      win_rate_toan_bo: s.tong_bao_gia > 0
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
          ${periodExpr}                                              AS period,
          COUNT(q.Id)                                                AS tong_bao_gia,
          COUNT(CASE WHEN q.TinhTrang = 4 THEN 1 END)               AS bao_gia_thanh_don,  -- Close Won
          COUNT(CASE WHEN q.TinhTrang = 5 THEN 1 END)               AS bao_gia_thua,       -- Close Lost
          COUNT(CASE WHEN q.TinhTrang = 3 THEN 1 END)               AS bao_gia_xac_nhan,   -- Đã xác nhận
          COUNT(CASE WHEN q.TinhTrang = 2 THEN 1 END)               AS bao_gia_da_gui      -- Đã gửi
        FROM dbo.Quotation q
        WHERE q.TrangThai != 0
          ${dateExtra}
        GROUP BY ${periodExpr}
        ORDER BY period ASC
      `);

      trendData = trendResult.recordset.map(r => {
        const coKQ = (r.bao_gia_thanh_don || 0) + (r.bao_gia_thua || 0);
        return {
          period:             r.period,
          tong_bao_gia:       r.tong_bao_gia,
          bao_gia_thanh_don:  r.bao_gia_thanh_don,  // TinhTrang=4
          bao_gia_thua:       r.bao_gia_thua,        // TinhTrang=5
          bao_gia_xac_nhan:   r.bao_gia_xac_nhan,   // TinhTrang=3
          bao_gia_da_gui:     r.bao_gia_da_gui,      // TinhTrang=2
          win_rate_phan_tram: coKQ > 0
            ? parseFloat(((r.bao_gia_thanh_don / coKQ) * 100).toFixed(2))
            : 0,
          win_rate_toan_bo: r.tong_bao_gia > 0
            ? parseFloat(((r.bao_gia_thanh_don / r.tong_bao_gia) * 100).toFixed(2))
            : 0,
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
 *       Tính tỉ lệ % số Lead cuối cùng chốt thành công (toàn bộ phễu bán hàng).
 *
 *       **Định nghĩa "Lead thành đơn"**: Lead có ít nhất 1 chuỗi:
 *       `Lead → Opportunity (LeadId) → Quotation (OpportunityId, TinhTrang=4 Close Won)`.
 *
 *       - **Tổng Lead**: Lead có TrangThai = 1 trong khoảng thời gian lọc.
 *       - **Lead có cơ hội**: Lead đã tạo Opportunity.
 *       - **Lead có báo giá**: Lead có Opportunity đã tạo Quotation.
 *       - **Lead thành đơn**: Lead có Quotation với `TinhTrang = 4` (Close Won).
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
 *                     tong_lead:         { type: integer, description: "Tổng Lead (TrangThai=1)" }
 *                     lead_co_co_hoi:    { type: integer, description: "Lead đã tạo Opportunity" }
 *                     lead_co_bao_gia:   { type: integer, description: "Lead có Opportunity đã tạo Quotation" }
 *                     lead_thanh_don:    { type: integer, description: "Lead có Quotation TinhTrang=4 (Close Won)" }
 *                     ti_le_phan_tram:   { type: number,  description: "Tỉ lệ end-to-end (%)" }
 *                 data:
 *                   type: array
 *                   description: Xu hướng theo kỳ (chỉ có khi truyền group_by)
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:          { type: string }
 *                       tong_lead:       { type: integer }
 *                       lead_co_co_hoi:  { type: integer }
 *                       lead_co_bao_gia: { type: integer }
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
    // "Lead thành đơn" = Lead có ít nhất 1 Quotation TinhTrang=4 (Close Won)
    // Dùng subquery GROUP BY l.Id để tránh duplicate từ multiple joins
    const reqSum = pool.request();
    addDateParams(reqSum, { dateFrom, dateTo });

    const sumResult = await reqSum.query(`
      SELECT
        COUNT(*)                   AS tong_lead,
        SUM(co_co_hoi)             AS lead_co_co_hoi,
        SUM(co_bao_gia)            AS lead_co_bao_gia,
        SUM(thanh_don)             AS lead_thanh_don
      FROM (
        SELECT
          l.Id,
          -- có Opportunity
          MAX(CASE WHEN op.Id IS NOT NULL THEN 1 ELSE 0 END)              AS co_co_hoi,
          -- có Quotation (bất kỳ trạng thái)
          MAX(CASE WHEN q.Id IS NOT NULL THEN 1 ELSE 0 END)               AS co_bao_gia,
          -- chốt thành công: Quotation TinhTrang = 4 (Close Won)
          MAX(CASE WHEN q.TinhTrang = 4 THEN 1 ELSE 0 END)               AS thanh_don
        FROM dbo.Lead l
        LEFT JOIN dbo.Opportunity op
          ON op.LeadId = l.Id AND op.TrangThai = 1
        LEFT JOIN dbo.Quotation q
          ON q.OpportunityId = op.Id AND q.TrangThai != 0
        WHERE l.TrangThai = 1
          ${dateExtra}
        GROUP BY l.Id
      ) AS sub
    `);

    const s = sumResult.recordset[0];
    const summary = {
      tong_lead:       s.tong_lead       || 0,
      lead_co_co_hoi:  s.lead_co_co_hoi  || 0,
      lead_co_bao_gia: s.lead_co_bao_gia || 0,
      lead_thanh_don:  s.lead_thanh_don  || 0,
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
          SUM(co_co_hoi)  AS lead_co_co_hoi,
          SUM(co_bao_gia) AS lead_co_bao_gia,
          SUM(thanh_don)  AS lead_thanh_don
        FROM (
          SELECT
            l.Id,
            ${periodExpr}                                                    AS period,
            MAX(CASE WHEN op.Id IS NOT NULL THEN 1 ELSE 0 END)              AS co_co_hoi,
            MAX(CASE WHEN q.Id IS NOT NULL THEN 1 ELSE 0 END)               AS co_bao_gia,
            MAX(CASE WHEN q.TinhTrang = 4 THEN 1 ELSE 0 END)               AS thanh_don
          FROM dbo.Lead l
          LEFT JOIN dbo.Opportunity op
            ON op.LeadId = l.Id AND op.TrangThai = 1
          LEFT JOIN dbo.Quotation q
            ON q.OpportunityId = op.Id AND q.TrangThai != 0
          WHERE l.TrangThai = 1
            ${dateExtra}
          GROUP BY l.Id, ${periodExpr}
        ) AS sub
        GROUP BY period
        ORDER BY period ASC
      `);

      trendData = trendResult.recordset.map(r => ({
        period:          r.period,
        tong_lead:       r.tong_lead       || 0,
        lead_co_co_hoi:  r.lead_co_co_hoi  || 0,
        lead_co_bao_gia: r.lead_co_bao_gia || 0,
        lead_thanh_don:  r.lead_thanh_don  || 0,
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
 *       Tỉ lệ % Báo giá chốt thành công (Close Won) phân tách theo từng nhân viên phụ trách cơ hội (`Opportunity.NguoiXuLyId`).
 *
 *       Dựa trên `Quotation.TinhTrang`:
 *       - **4** = Close Won ← được tính là "thành đơn"
 *       - **5** = Close Lost
 *       - **3** = Đã xác nhận
 *       - **2** = Đã gửi
 *       - **1** = Nháp
 *
 *       - **win_rate_phan_tram**: tính trên số đã có kết quả (Close Won + Close Lost).
 *       - **win_rate_toan_bo**: tính trên toàn bộ báo giá của rep đó.
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
 *                 tong_bao_gia:            { type: integer }
 *                 tong_bao_gia_thanh_don:  { type: integer, description: "TinhTrang=4" }
 *                 tong_bao_gia_thua:       { type: integer, description: "TinhTrang=5" }
 *                 win_rate_tong:           { type: number, description: "Win Rate trên đã có kết quả (%)" }
 *                 win_rate_tong_toan_bo:   { type: number, description: "Win Rate trên toàn bộ (%)" }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       sales_rep_id:       { type: string }
 *                       FullName:           { type: string }
 *                       UserName:           { type: string }
 *                       tong_bao_gia:       { type: integer }
 *                       bao_gia_thanh_don:  { type: integer, description: "TinhTrang=4 Close Won" }
 *                       bao_gia_thua:       { type: integer, description: "TinhTrang=5 Close Lost" }
 *                       bao_gia_dang_cho:   { type: integer, description: "TinhTrang=2,3" }
 *                       win_rate_phan_tram: { type: number, description: "Win Rate trên đã có kết quả (%)" }
 *                       win_rate_toan_bo:   { type: number, description: "Win Rate trên toàn bộ (%)" }
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

    // Win Rate dựa trên Quotation.TinhTrang:
    //   4 = Close Won  → báo giá thành đơn
    //   5 = Close Lost → báo giá thua
    //   2,3 = Đang chờ kết quả
    const result = await request.query(`
      SELECT
        op.NguoiXuLyId                                              AS sales_rep_id,
        ISNULL(u.FullName, N'Chưa phân công')                     AS FullName,
        ISNULL(u.UserName, '')                                       AS UserName,
        COUNT(q.Id)                                                  AS tong_bao_gia,
        COUNT(CASE WHEN q.TinhTrang = 4 THEN 1 END)                 AS bao_gia_thanh_don,  -- Close Won
        COUNT(CASE WHEN q.TinhTrang = 5 THEN 1 END)                 AS bao_gia_thua,        -- Close Lost
        COUNT(CASE WHEN q.TinhTrang IN (2, 3) THEN 1 END)           AS bao_gia_dang_cho     -- Đang chờ
      FROM dbo.Quotation q
      LEFT JOIN dbo.Opportunity op
        ON op.Id = q.OpportunityId AND op.TrangThai = 1
      LEFT JOIN dbo.[UserFunction] u
        ON u.UserId = op.NguoiXuLyId
      WHERE q.TrangThai != 0
        ${dateExtra}
      GROUP BY op.NguoiXuLyId, u.FullName, u.UserName
      ORDER BY bao_gia_thanh_don DESC
    `);

    const tongBaoGia         = result.recordset.reduce((s, r) => s + (r.tong_bao_gia       || 0), 0);
    const tongBaoGiaThanhDon = result.recordset.reduce((s, r) => s + (r.bao_gia_thanh_don  || 0), 0);
    const tongBaoGiaThua     = result.recordset.reduce((s, r) => s + (r.bao_gia_thua       || 0), 0);
    const tongCoKetQua       = tongBaoGiaThanhDon + tongBaoGiaThua;

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      tong_bao_gia:            tongBaoGia,
      tong_bao_gia_thanh_don:  tongBaoGiaThanhDon,
      tong_bao_gia_thua:       tongBaoGiaThua,
      // Win Rate trên tổng đã có kết quả (Close Won + Close Lost)
      win_rate_tong: tongCoKetQua > 0
        ? parseFloat(((tongBaoGiaThanhDon / tongCoKetQua) * 100).toFixed(2))
        : 0,
      // Win Rate trên toàn bộ báo giá
      win_rate_tong_toan_bo: tongBaoGia > 0
        ? parseFloat(((tongBaoGiaThanhDon / tongBaoGia) * 100).toFixed(2))
        : 0,
      data: result.recordset.map(r => {
        const coKQ = (r.bao_gia_thanh_don || 0) + (r.bao_gia_thua || 0);
        return {
          sales_rep_id:       r.sales_rep_id,
          FullName:           r.FullName,
          UserName:           r.UserName,
          tong_bao_gia:       r.tong_bao_gia,
          bao_gia_thanh_don:  r.bao_gia_thanh_don,  // TinhTrang=4
          bao_gia_thua:       r.bao_gia_thua,        // TinhTrang=5
          bao_gia_dang_cho:   r.bao_gia_dang_cho,    // TinhTrang=2,3
          win_rate_phan_tram: coKQ > 0
            ? parseFloat(((r.bao_gia_thanh_don / coKQ) * 100).toFixed(2))
            : 0,
          win_rate_toan_bo: r.tong_bao_gia > 0
            ? parseFloat(((r.bao_gia_thanh_don / r.tong_bao_gia) * 100).toFixed(2))
            : 0,
        };
      }),
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
 *       Tỉ lệ % Báo giá chốt thành công (Close Won) phân tách theo sản phẩm hoặc nhóm sản phẩm.
 *
 *       Dựa trên `Quotation.TinhTrang`:
 *       - **4** = Close Won ← được tính là "thành đơn"
 *       - **5** = Close Lost
 *
 *       - **Tổng Báo giá** (có chứa sản phẩm đó): số Quotation có LineItem sản phẩm đó.
 *       - **Báo giá thành đơn**: Quotation có `TinhTrang = 4` (Close Won).
 *       - **win_rate_phan_tram**: tính trên đã có kết quả (Close Won + Close Lost).
 *       - **win_rate_toan_bo**: tính trên toàn bộ báo giá có sản phẩm đó.
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
 *                 tong_bao_gia:            { type: integer }
 *                 tong_bao_gia_thanh_don:  { type: integer, description: "TinhTrang=4 Close Won" }
 *                 tong_bao_gia_thua:       { type: integer, description: "TinhTrang=5 Close Lost" }
 *                 win_rate_tong:           { type: number, description: "Win Rate trên đã có kết quả (%)" }
 *                 win_rate_tong_toan_bo:   { type: number, description: "Win Rate trên toàn bộ (%)" }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:                 { type: integer }
 *                       ten:                { type: string }
 *                       nhom_cha_id:        { type: integer, description: "Chỉ có ở level=subgroup" }
 *                       ten_nhom_cha:       { type: string,  description: "Chỉ có ở level=subgroup" }
 *                       ma_hang:            { type: string,  description: "Chỉ có ở level=product" }
 *                       tong_bao_gia:       { type: integer }
 *                       bao_gia_thanh_don:  { type: integer, description: "TinhTrang=4" }
 *                       bao_gia_thua:       { type: integer, description: "TinhTrang=5" }
 *                       win_rate_phan_tram: { type: number, description: "Win Rate trên đã có kết quả" }
 *                       win_rate_toan_bo:   { type: number, description: "Win Rate trên toàn bộ" }
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
      // Product: nhóm theo từng sản phẩm
      selectDims = `
        p.Id                                                   AS id,
        ISNULL(p.TenSanPham, N'(Không tên)')                 AS ten,
        p.SKU                                                  AS ma_hang`;
      groupDims = `p.Id, p.TenSanPham, p.SKU`;
    } else if (level === 'subgroup') {
      // Subgroup: nhóm theo danh mục sản phẩm cấp con
      selectDims = `
        tn.Id                                                  AS id,
        ISNULL(tn.TieuDe, N'(Chưa phân nhóm)')              AS ten,
        tnp.Id                                                 AS nhom_cha_id,
        ISNULL(tnp.TieuDe, N'(Nhóm gốc)')                   AS ten_nhom_cha`;
      groupDims = `tn.Id, tn.TieuDe, tnp.Id, tnp.TieuDe`;
    } else {
      // group (mặc định): nhóm theo danh mục cấp cha
      // Dùng COALESCE(tnp.Id, tn.Id) trong cả SELECT lẫn GROUP BY
      // để gộp đúng: sản phẩm không có nhóm con thì dùng chính nhóm con làm nhóm cha
      selectDims = `
        COALESCE(tnp.Id,     tn.Id)                                                    AS id,
        ISNULL(COALESCE(tnp.TieuDe, tn.TieuDe), N'(Chưa phân nhóm)')                AS ten`;
      groupDims = `COALESCE(tnp.Id, tn.Id), COALESCE(tnp.TieuDe, tn.TieuDe)`;
    }

    // Win Rate dựa trên Quotation.TinhTrang (không cần JOIN Order):
    //   4 = Close Won  → báo giá thành đơn
    //   5 = Close Lost → báo giá thua
    // Dùng COUNT(DISTINCT q.Id) để khả dụng: 1 BG có nhiều sản phẩm nhưng chỉ đếm 1 lần
    const result = await request.query(`
      SELECT
        ${selectDims},
        COUNT(DISTINCT q.Id)                                             AS tong_bao_gia,
        COUNT(DISTINCT CASE WHEN q.TinhTrang = 4 THEN q.Id END)         AS bao_gia_thanh_don,  -- Close Won
        COUNT(DISTINCT CASE WHEN q.TinhTrang = 5 THEN q.Id END)         AS bao_gia_thua         -- Close Lost
      FROM dbo.Quotation q
      INNER JOIN dbo.LinkQuotationProduct lqp ON lqp.QuotationId = q.Id
      INNER JOIN dbo.Product              p   ON p.Id = lqp.ProductId
      LEFT  JOIN dbo.Taxonomy             tn  ON tn.Id  = p.NhomThietBiId
      LEFT  JOIN dbo.Taxonomy             tnp ON tnp.Id = tn.KhoaChaId
      ${whereClause}
      GROUP BY ${groupDims}
      ORDER BY bao_gia_thanh_don DESC
    `);

    const tongBaoGia         = result.recordset.reduce((s, r) => s + (r.tong_bao_gia       || 0), 0);
    const tongBaoGiaThanhDon = result.recordset.reduce((s, r) => s + (r.bao_gia_thanh_don  || 0), 0);
    const tongBaoGiaThua     = result.recordset.reduce((s, r) => s + (r.bao_gia_thua       || 0), 0);
    const tongCoKetQua       = tongBaoGiaThanhDon + tongBaoGiaThua;

    const data = result.recordset.map(r => {
      const coKQ = (r.bao_gia_thanh_don || 0) + (r.bao_gia_thua || 0);
      const row = {
        id:                 r.id,
        ten:                r.ten,
        tong_bao_gia:       r.tong_bao_gia,
        bao_gia_thanh_don:  r.bao_gia_thanh_don,  // TinhTrang=4
        bao_gia_thua:       r.bao_gia_thua,        // TinhTrang=5
        win_rate_phan_tram: coKQ > 0
          ? parseFloat(((r.bao_gia_thanh_don / coKQ) * 100).toFixed(2))
          : 0,
        win_rate_toan_bo: r.tong_bao_gia > 0
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
      tong_bao_gia_thua:       tongBaoGiaThua,
      // Win Rate trên tổng đã có kết quả (Close Won + Close Lost)
      win_rate_tong: tongCoKetQua > 0
        ? parseFloat(((tongBaoGiaThanhDon / tongCoKetQua) * 100).toFixed(2))
        : 0,
      // Win Rate trên toàn bộ báo giá
      win_rate_tong_toan_bo: tongBaoGia > 0
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
