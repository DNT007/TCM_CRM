const express = require('express');
const router  = express.Router();
const { sql, getPool } = require('../db');

/**
 * @swagger
 * tags:
 *   name: Quotations
 *   description: Thống kê Báo giá (dbo.Quotation)
 */

// ─── Helper: xây WHERE clause chung ───────────────────────────────────────────
function buildWhere(alias, { dateFrom, dateTo } = {}, extra = []) {
  const conds = [`${alias}.TrangThai != 0`, ...extra];
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
 *     quoteDateFrom:
 *       in: query
 *       name: date_from
 *       schema: { type: string, format: date }
 *       example: "2024-01-01"
 *       description: Lọc từ ngày (yyyy-MM-dd)
 *     quoteDateTo:
 *       in: query
 *       name: date_to
 *       schema: { type: string, format: date }
 *       example: "2024-12-31"
 *       description: Lọc đến ngày (yyyy-MM-dd)
 */

// ══════════════════════════════════════════════════════════════════════════════
// 1. GET /api/quotations/stats/by-time
//    Số báo giá gửi theo thời gian (ngày / tuần / tháng)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/quotations/stats/by-time:
 *   get:
 *     summary: "Số báo giá gửi theo thời gian (ngày / tuần / tháng)"
 *     description: |
 *       Thống kê số lượng báo giá được tạo/gửi trong từng kỳ thời gian.
 *       Hỗ trợ lọc theo `date_from` / `date_to` và nhóm theo `group_by` (day / week / month).
 *       Trả về số báo giá, tổng giá trị và giá trị trung bình theo từng kỳ.
 *     tags: [Quotations]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/quoteDateFrom'
 *       - $ref: '#/components/parameters/quoteDateTo'
 *       - in: query
 *         name: group_by
 *         description: Nhóm theo ngày, tuần hoặc tháng
 *         schema: { type: string, enum: [day, week, month], default: month }
 *     responses:
 *       200:
 *         description: Số lượng báo giá gửi theo kỳ thời gian
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:      { type: boolean }
 *                 filter:       { type: object }
 *                 tong_bao_gia: { type: integer, description: "Tổng số báo giá trong kỳ" }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:         { type: string, example: "2024-01" }
 *                       so_bao_gia:     { type: integer }
 *                       tong_gia_tri:   { type: number,  description: "Tổng TongTien (VNĐ)" }
 *                       trung_binh:     { type: number,  description: "Trung bình TongTien" }
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
      periodExpr = `FORMAT(q.NgayTao, 'yyyy-MM-dd')`;
    } else if (groupBy === 'week') {
      periodExpr = `CONCAT(YEAR(q.NgayTao), '-W', RIGHT('00' + CAST(DATEPART(isowk, q.NgayTao) AS VARCHAR(2)), 2))`;
    } else {
      periodExpr = `FORMAT(q.NgayTao, 'yyyy-MM')`;
    }

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });
    const where = buildWhere('q', { dateFrom, dateTo });

    const result = await request.query(`
      SELECT
        ${periodExpr}                       AS period,
        COUNT(q.Id)                         AS so_bao_gia,
        ISNULL(SUM(q.TongGiaTri), 0)        AS tong_gia_tri,
        ISNULL(AVG(q.TongGiaTri), 0)        AS trung_binh
      FROM dbo.Quotation q
      ${where}
      GROUP BY ${periodExpr}
      ORDER BY period ASC
    `);

    const tong_bao_gia = result.recordset.reduce((s, r) => s + (r.so_bao_gia || 0), 0);

    res.json({
      success:      true,
      filter:       { date_from: dateFrom, date_to: dateTo, group_by: groupBy },
      tong_bao_gia,
      data:         result.recordset,
    });
  } catch (err) {
    console.error('[GET /quotations/stats/by-time]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. GET /api/quotations/stats/by-sales-rep
//    Số báo giá theo sales rep (người tạo / người phụ trách)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/quotations/stats/by-sales-rep:
 *   get:
 *     summary: "Số báo giá theo sales rep / người phụ trách"
 *     description: |
 *       Thống kê số báo giá và tổng giá trị theo từng nhân viên phụ trách (NguoiXuLyId).
 *       Kết quả sắp xếp giảm dần theo tổng giá trị báo giá.
 *     tags: [Quotations]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/quoteDateFrom'
 *       - $ref: '#/components/parameters/quoteDateTo'
 *     responses:
 *       200:
 *         description: Phân bố báo giá theo nhân viên phụ trách
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
 *                       so_bao_gia:     { type: integer }
 *                       tong_gia_tri:   { type: number,  description: "Tổng TongTien (VNĐ)" }
 *                       trung_binh:     { type: number,  description: "Trung bình TongTien" }
 *                       max_gia_tri:    { type: number }
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
    const where = buildWhere('q', { dateFrom, dateTo });

    const result = await request.query(`
      SELECT
        q.NguoiXuLyId                                    AS sales_rep_id,
        ISNULL(u.FullName, N'Chưa phân công')            AS FullName,
        ISNULL(u.UserName, '')                            AS UserName,
        COUNT(q.Id)                                       AS so_bao_gia,
        ISNULL(SUM(q.TongGiaTri), 0)                     AS tong_gia_tri,
        ISNULL(AVG(q.TongGiaTri), 0)                     AS trung_binh,
        ISNULL(MAX(q.TongGiaTri), 0)                     AS max_gia_tri
      FROM dbo.Quotation q
      LEFT JOIN dbo.[UserFunction] u ON q.NguoiXuLyId = u.UserId
      ${where}
      GROUP BY q.NguoiXuLyId, u.FullName, u.UserName
      ORDER BY tong_gia_tri DESC
    `);

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      data:    result.recordset,
    });
  } catch (err) {
    console.error('[GET /quotations/stats/by-sales-rep]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. GET /api/quotations/stats/win-loss-rate
//    Tỉ lệ báo giá → thắng / thua
//    TinhTrang (dbo.Quotation):
//      1 = Nháp           (Draft)
//      2 = Đã gửi         (Sent)
//      3 = Thắng / Chốt   (Won)
//      4 = Thua / Từ chối (Lost)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/quotations/stats/win-loss-rate:
 *   get:
 *     summary: "Tỉ lệ báo giá → thắng / thua"
 *     description: |
 *       Thống kê và tính tỉ lệ phần trăm báo giá thắng (Won) và thua (Lost).
 *       Phân loại dựa trên trường `TinhTrang` của `dbo.Quotation`:
 *       - **1**: Nháp (Draft)
 *       - **2**: Đã gửi (Sent)
 *       - **3**: Thắng / Đã chốt (Won)
 *       - **4**: Thua / Từ chối (Lost)
 *
 *       Trả về tổng hợp toàn bộ và (nếu có `group_by`) xu hướng tỉ lệ thắng/thua theo kỳ thời gian.
 *     tags: [Quotations]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/quoteDateFrom'
 *       - $ref: '#/components/parameters/quoteDateTo'
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
 *         description: Tỉ lệ thắng / thua báo giá
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
 *                     tong_bao_gia:         { type: integer, description: "Tổng tất cả báo giá (đã gửi + thắng + thua)" }
 *                     so_thang:             { type: integer }
 *                     so_thua:              { type: integer }
 *                     so_dang_cho:          { type: integer, description: "Đã gửi, chưa có kết quả" }
 *                     so_nhap:              { type: integer }
 *                     ti_le_thang:          { type: number,  description: "% thắng trên tổng đã có kết quả" }
 *                     ti_le_thua:           { type: number,  description: "% thua trên tổng đã có kết quả" }
 *                     ti_le_thang_toan_bo:  { type: number,  description: "% thắng trên tổng báo giá (kể cả đang chờ)" }
 *                     tong_gia_tri_thang:   { type: number }
 *                     tong_gia_tri_thua:    { type: number }
 *                 detail:
 *                   type: array
 *                   description: Chi tiết theo từng TinhTrang
 *                   items:
 *                     type: object
 *                     properties:
 *                       tinh_trang:   { type: integer }
 *                       ten_trang:    { type: string, example: "Thắng" }
 *                       so_bao_gia:   { type: integer }
 *                       tong_gia_tri: { type: number }
 *                       ti_le:        { type: number }
 *                 data:
 *                   type: array
 *                   description: Xu hướng theo kỳ (chỉ trả khi có group_by)
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:        { type: string }
 *                       so_thang:      { type: integer }
 *                       so_thua:       { type: integer }
 *                       so_dang_cho:   { type: integer }
 *                       ti_le_thang:   { type: number }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/win-loss-rate', async (req, res) => {
  try {
    const pool       = getPool();
    const dateFrom   = req.query.date_from   || null;
    const dateTo     = req.query.date_to     || null;
    const groupBy    = req.query.group_by    || null; // day | week | month | null
    const salesRepId = req.query.sales_rep_id || null;

    // Nhãn tên TinhTrang
    const TINH_TRANG_MAP = {
      1: 'Nháp',
      2: 'Đã gửi',
      3: 'Thắng',
      4: 'Thua',
    };

    // ── Xây WHERE ──────────────────────────────────────────────────────────────
    const conds = ['q.TrangThai != 0'];
    if (dateFrom)   conds.push(`q.NgayTao >= @dateFrom`);
    if (dateTo)     conds.push(`q.NgayTao <= @dateTo`);
    if (salesRepId) conds.push(`q.NguoiXuLyId = @salesRepId`);
    const whereClause = `WHERE ${conds.join(' AND ')}`;

    // ── Summary: nhóm theo TinhTrang ───────────────────────────────────────────
    const reqSummary = pool.request();
    addDateParams(reqSummary, { dateFrom, dateTo });
    if (salesRepId) reqSummary.input('salesRepId', sql.NVarChar, salesRepId);

    const summaryResult = await reqSummary.query(`
      SELECT
        q.TinhTrang                          AS tinh_trang,
        COUNT(q.Id)                          AS so_bao_gia,
        ISNULL(SUM(q.TongGiaTri), 0)         AS tong_gia_tri
      FROM dbo.Quotation q
      ${whereClause}
      GROUP BY q.TinhTrang
      ORDER BY q.TinhTrang ASC
    `);

    const rows = summaryResult.recordset;

    // Tổng hợp từng nhóm
    let soThang     = 0, soThua = 0, soDangCho = 0, soNhap = 0;
    let giaTriThang = 0, giaTriThua = 0;

    const detail = rows.map(r => {
      const tt = r.tinh_trang;
      if (tt === 3) { soThang   = r.so_bao_gia; giaTriThang = Number(r.tong_gia_tri); }
      if (tt === 4) { soThua    = r.so_bao_gia; giaTriThua  = Number(r.tong_gia_tri); }
      if (tt === 2) { soDangCho = r.so_bao_gia; }
      if (tt === 1) { soNhap    = r.so_bao_gia; }
      return {
        tinh_trang:   tt,
        ten_trang:    TINH_TRANG_MAP[tt] || `TinhTrang ${tt}`,
        so_bao_gia:   r.so_bao_gia,
        tong_gia_tri: Number(r.tong_gia_tri),
      };
    });

    const tongBaoGia      = rows.reduce((s, r) => s + r.so_bao_gia, 0);
    const tongCoKetQua    = soThang + soThua;                        // chỉ thắng + thua
    const tiLeThang       = tongCoKetQua > 0
      ? parseFloat(((soThang / tongCoKetQua) * 100).toFixed(2))
      : 0;
    const tiLeThua        = tongCoKetQua > 0
      ? parseFloat(((soThua  / tongCoKetQua) * 100).toFixed(2))
      : 0;
    const tiLeThangToanBo = tongBaoGia > 0
      ? parseFloat(((soThang / tongBaoGia) * 100).toFixed(2))
      : 0;

    // Thêm ti_le vào detail (trên tổng toàn bộ)
    detail.forEach(d => {
      d.ti_le = tongBaoGia > 0
        ? parseFloat(((d.so_bao_gia / tongBaoGia) * 100).toFixed(2))
        : 0;
    });

    const summary = {
      tong_bao_gia:        tongBaoGia,
      so_thang:            soThang,
      so_thua:             soThua,
      so_dang_cho:         soDangCho,
      so_nhap:             soNhap,
      ti_le_thang:         tiLeThang,
      ti_le_thua:          tiLeThua,
      ti_le_thang_toan_bo: tiLeThangToanBo,
      tong_gia_tri_thang:  giaTriThang,
      tong_gia_tri_thua:   giaTriThua,
    };

    // ── Xu hướng theo kỳ (chỉ khi có group_by) ───────────────────────────────
    let trendData = [];
    if (groupBy) {
      let periodExpr;
      if (groupBy === 'day') {
        periodExpr = `FORMAT(q.NgayTao, 'yyyy-MM-dd')`;
      } else if (groupBy === 'week') {
        periodExpr = `CONCAT(YEAR(q.NgayTao), '-W', RIGHT('00' + CAST(DATEPART(isowk, q.NgayTao) AS VARCHAR(2)), 2))`;
      } else {
        periodExpr = `FORMAT(q.NgayTao, 'yyyy-MM')`;
      }

      const reqTrend = pool.request();
      addDateParams(reqTrend, { dateFrom, dateTo });
      if (salesRepId) reqTrend.input('salesRepId', sql.NVarChar, salesRepId);

      const trendResult = await reqTrend.query(`
        SELECT
          ${periodExpr}                                                    AS period,
          COUNT(CASE WHEN q.TinhTrang = 3 THEN 1 END)                     AS so_thang,
          COUNT(CASE WHEN q.TinhTrang = 4 THEN 1 END)                     AS so_thua,
          COUNT(CASE WHEN q.TinhTrang = 2 THEN 1 END)                     AS so_dang_cho,
          COUNT(q.Id)                                                      AS tong_ky
        FROM dbo.Quotation q
        ${whereClause}
        GROUP BY ${periodExpr}
        ORDER BY period ASC
      `);

      trendData = trendResult.recordset.map(r => {
        const coKetQua = (r.so_thang || 0) + (r.so_thua || 0);
        return {
          period:      r.period,
          so_thang:    r.so_thang   || 0,
          so_thua:     r.so_thua    || 0,
          so_dang_cho: r.so_dang_cho || 0,
          tong_ky:     r.tong_ky    || 0,
          ti_le_thang: coKetQua > 0
            ? parseFloat(((r.so_thang / coKetQua) * 100).toFixed(2))
            : 0,
        };
      });
    }

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, group_by: groupBy, sales_rep_id: salesRepId },
      summary,
      detail,
      data:    trendData,
    });
  } catch (err) {
    console.error('[GET /quotations/stats/win-loss-rate]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. GET /api/quotations/stats/opportunity-to-quotation-time
//    Thời gian trung bình từ cơ hội → báo giá
//    Tính DATEDIFF(minute, Opportunity.NgayTao, Quotation.NgayTao)
//    chỉ lấy các cặp hợp lệ: Quotation.NgayTao >= Opportunity.NgayTao
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/quotations/stats/opportunity-to-quotation-time:
 *   get:
 *     summary: "Thời gian trung bình từ cơ hội → báo giá"
 *     description: |
 *       Tính thời gian chuyển đổi trung bình từ khi tạo **Opportunity** đến khi tạo **Quotation**
 *       (JOIN dbo.Opportunity qua OpportunityId, chỉ tính các cặp hợp lệ: NgayTao Quotation >= NgayTao Opportunity).
 *       Hỗ trợ lọc theo `date_from` / `date_to` (theo NgayTao Quotation) và `group_by` để xem xu hướng theo thời gian.
 *     tags: [Quotations]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/quoteDateFrom'
 *       - $ref: '#/components/parameters/quoteDateTo'
 *       - in: query
 *         name: group_by
 *         description: "Xem xu hướng theo kỳ (để trống = chỉ trả summary)"
 *         schema: { type: string, enum: [day, week, month] }
 *     responses:
 *       200:
 *         description: Thời gian trung bình opportunity → quotation
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
 *                     tong_cap_hop_le:   { type: integer, description: "Số cặp Opportunity–Quotation hợp lệ" }
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
router.get('/stats/opportunity-to-quotation-time', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || null; // day | week | month | null

    // Điều kiện:
    //   - Quotation còn hoạt động (TrangThai != 0)
    //   - Opportunity còn hoạt động (TrangThai = 1)
    //   - Quotation có liên kết Opportunity (OpportunityId NOT NULL)
    //   - Quotation.NgayTao >= Opportunity.NgayTao (cặp hợp lệ)
    const extraConds = [
      'o.TrangThai = 1',
      'q.OpportunityId IS NOT NULL',
      'q.NgayTao >= o.NgayTao',
    ];
    const conds = ['q.TrangThai != 0', ...extraConds];
    if (dateFrom) conds.push(`q.NgayTao >= @dateFrom`);
    if (dateTo)   conds.push(`q.NgayTao <= @dateTo`);
    const whereClause = `WHERE ${conds.join(' AND ')}`;

    // ── Summary (tổng hợp) ───────────────────────────────────────────────────
    const reqSummary = pool.request();
    addDateParams(reqSummary, { dateFrom, dateTo });

    const summaryResult = await reqSummary.query(`
      SELECT
        COUNT(*)                                                              AS tong_cap_hop_le,
        AVG(CAST(DATEDIFF(minute, o.NgayTao, q.NgayTao) AS FLOAT))           AS avg_phut,
        MIN(CAST(DATEDIFF(minute, o.NgayTao, q.NgayTao) AS FLOAT))           AS min_phut,
        MAX(CAST(DATEDIFF(minute, o.NgayTao, q.NgayTao) AS FLOAT))           AS max_phut
      FROM dbo.Quotation q
      INNER JOIN dbo.Opportunity o ON q.OpportunityId = o.Id
      ${whereClause}
    `);

    const s = summaryResult.recordset[0];
    const summary = {
      tong_cap_hop_le: s.tong_cap_hop_le,
      trung_binh_phut: s.avg_phut != null ? parseFloat(s.avg_phut.toFixed(2))           : null,
      trung_binh_gio:  s.avg_phut != null ? parseFloat((s.avg_phut / 60).toFixed(2))    : null,
      trung_binh_ngay: s.avg_phut != null ? parseFloat((s.avg_phut / 1440).toFixed(4))  : null,
      min_ngay:        s.min_phut != null ? parseFloat((s.min_phut / 1440).toFixed(4))  : null,
      max_ngay:        s.max_phut != null ? parseFloat((s.max_phut / 1440).toFixed(4))  : null,
    };

    // ── Xu hướng theo kỳ (chỉ khi có group_by) ───────────────────────────────
    let trendData = [];
    if (groupBy) {
      let periodExpr;
      if (groupBy === 'day') {
        periodExpr = `FORMAT(q.NgayTao, 'yyyy-MM-dd')`;
      } else if (groupBy === 'week') {
        periodExpr = `CONCAT(YEAR(q.NgayTao), '-W', RIGHT('00' + CAST(DATEPART(isowk, q.NgayTao) AS VARCHAR(2)), 2))`;
      } else {
        periodExpr = `FORMAT(q.NgayTao, 'yyyy-MM')`;
      }

      const reqTrend = pool.request();
      addDateParams(reqTrend, { dateFrom, dateTo });

      const trendResult = await reqTrend.query(`
        SELECT
          ${periodExpr}                                                          AS period,
          COUNT(*)                                                               AS so_cap,
          AVG(CAST(DATEDIFF(minute, o.NgayTao, q.NgayTao) AS FLOAT))            AS avg_phut
        FROM dbo.Quotation q
        INNER JOIN dbo.Opportunity o ON q.OpportunityId = o.Id
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
      data:    trendData,
    });
  } catch (err) {
    console.error('[GET /quotations/stats/opportunity-to-quotation-time]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. GET /api/quotations/stats/avg-edit-count
//    Số lần chỉnh sửa trung bình mỗi báo giá
//    Dựa trên cột Version (int): Version = 1 → chưa sửa, Version = N → sửa N-1 lần
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/quotations/stats/avg-edit-count:
 *   get:
 *     summary: "Số lần chỉnh sửa trung bình mỗi báo giá"
 *     description: |
 *       Thống kê số lần chỉnh sửa của từng báo giá dựa trên cột **Version**
 *       (`Version = 1` = chưa sửa lần nào, `Version = N` = đã sửa N-1 lần).
 *       Trả về summary tổng hợp và (nếu có `group_by`) xu hướng theo kỳ thời gian.
 *       Hỗ trợ lọc theo `sales_rep_id` để xem theo từng nhân viên.
 *     tags: [Quotations]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/quoteDateFrom'
 *       - $ref: '#/components/parameters/quoteDateTo'
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
 *         description: Số lần chỉnh sửa trung bình mỗi báo giá
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
 *                     tong_bao_gia:          { type: integer }
 *                     trung_binh_chinh_sua:  { type: number,  description: "Trung bình số lần sửa (= AVG(Version) - 1)" }
 *                     trung_binh_version:    { type: number,  description: "Trung bình Version thô" }
 *                     max_chinh_sua:         { type: integer, description: "Báo giá bị sửa nhiều nhất (= MAX(Version) - 1)" }
 *                     so_chua_chinh_sua:     { type: integer, description: "Số báo giá Version = 1 (chưa sửa lần nào)" }
 *                     so_da_chinh_sua:       { type: integer, description: "Số báo giá Version > 1 (đã sửa ít nhất 1 lần)" }
 *                     ti_le_da_chinh_sua:    { type: number,  description: "% báo giá đã bị chỉnh sửa" }
 *                 by_sales_rep:
 *                   type: array
 *                   description: Chi tiết theo từng nhân viên
 *                   items:
 *                     type: object
 *                     properties:
 *                       sales_rep_id:         { type: string }
 *                       FullName:             { type: string }
 *                       so_bao_gia:           { type: integer }
 *                       trung_binh_chinh_sua: { type: number }
 *                       max_chinh_sua:        { type: integer }
 *                 data:
 *                   type: array
 *                   description: Xu hướng theo kỳ (chỉ trả khi có group_by)
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:               { type: string }
 *                       so_bao_gia:           { type: integer }
 *                       trung_binh_chinh_sua: { type: number }
 *                       max_chinh_sua:        { type: integer }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/avg-edit-count', async (req, res) => {
  try {
    const pool       = getPool();
    const dateFrom   = req.query.date_from    || null;
    const dateTo     = req.query.date_to      || null;
    const groupBy    = req.query.group_by     || null;
    const salesRepId = req.query.sales_rep_id || null;

    // ── WHERE ────────────────────────────────────────────────────────────────
    const conds = ['q.TrangThai != 0', 'q.Version IS NOT NULL', 'q.Version >= 1'];
    if (dateFrom)   conds.push(`q.NgayTao >= @dateFrom`);
    if (dateTo)     conds.push(`q.NgayTao <= @dateTo`);
    if (salesRepId) conds.push(`q.NguoiXuLyId = @salesRepId`);
    const whereClause = `WHERE ${conds.join(' AND ')}`;

    // ── Summary tổng hợp ─────────────────────────────────────────────────────
    const reqSummary = pool.request();
    addDateParams(reqSummary, { dateFrom, dateTo });
    if (salesRepId) reqSummary.input('salesRepId', sql.NVarChar, salesRepId);

    const summaryResult = await reqSummary.query(`
      SELECT
        COUNT(q.Id)                                           AS tong_bao_gia,
        AVG(CAST(q.Version AS FLOAT))                        AS avg_version,
        MAX(q.Version)                                        AS max_version,
        SUM(CASE WHEN q.Version = 1 THEN 1 ELSE 0 END)       AS so_chua_chinh_sua,
        SUM(CASE WHEN q.Version > 1 THEN 1 ELSE 0 END)       AS so_da_chinh_sua
      FROM dbo.Quotation q
      ${whereClause}
    `);

    const s = summaryResult.recordset[0];
    const tongBaoGia = s.tong_bao_gia || 0;
    const summary = {
      tong_bao_gia:         tongBaoGia,
      trung_binh_chinh_sua: s.avg_version != null
        ? parseFloat((s.avg_version - 1).toFixed(2))
        : null,
      trung_binh_version:   s.avg_version != null
        ? parseFloat(s.avg_version.toFixed(2))
        : null,
      max_chinh_sua:        s.max_version != null ? s.max_version - 1 : null,
      so_chua_chinh_sua:    s.so_chua_chinh_sua || 0,
      so_da_chinh_sua:      s.so_da_chinh_sua   || 0,
      ti_le_da_chinh_sua:   tongBaoGia > 0
        ? parseFloat(((s.so_da_chinh_sua / tongBaoGia) * 100).toFixed(2))
        : 0,
    };

    // ── Phân tích theo sales rep ──────────────────────────────────────────────
    const reqRep = pool.request();
    addDateParams(reqRep, { dateFrom, dateTo });
    if (salesRepId) reqRep.input('salesRepId', sql.NVarChar, salesRepId);

    const repResult = await reqRep.query(`
      SELECT
        q.NguoiXuLyId                                        AS sales_rep_id,
        ISNULL(u.FullName, N'Chưa phân công')                AS FullName,
        COUNT(q.Id)                                          AS so_bao_gia,
        AVG(CAST(q.Version AS FLOAT))                        AS avg_version,
        MAX(q.Version)                                       AS max_version
      FROM dbo.Quotation q
      LEFT JOIN dbo.[UserFunction] u ON q.NguoiXuLyId = u.UserId
      ${whereClause}
      GROUP BY q.NguoiXuLyId, u.FullName
      ORDER BY avg_version DESC
    `);

    const bySalesRep = repResult.recordset.map(r => ({
      sales_rep_id:         r.sales_rep_id,
      FullName:             r.FullName,
      so_bao_gia:           r.so_bao_gia,
      trung_binh_chinh_sua: r.avg_version != null
        ? parseFloat((r.avg_version - 1).toFixed(2))
        : null,
      max_chinh_sua:        r.max_version != null ? r.max_version - 1 : null,
    }));

    // ── Xu hướng theo kỳ (chỉ khi có group_by) ───────────────────────────────
    let trendData = [];
    if (groupBy) {
      let periodExpr;
      if (groupBy === 'day') {
        periodExpr = `FORMAT(q.NgayTao, 'yyyy-MM-dd')`;
      } else if (groupBy === 'week') {
        periodExpr = `CONCAT(YEAR(q.NgayTao), '-W', RIGHT('00' + CAST(DATEPART(isowk, q.NgayTao) AS VARCHAR(2)), 2))`;
      } else {
        periodExpr = `FORMAT(q.NgayTao, 'yyyy-MM')`;
      }

      const reqTrend = pool.request();
      addDateParams(reqTrend, { dateFrom, dateTo });
      if (salesRepId) reqTrend.input('salesRepId', sql.NVarChar, salesRepId);

      const trendResult = await reqTrend.query(`
        SELECT
          ${periodExpr}                          AS period,
          COUNT(q.Id)                            AS so_bao_gia,
          AVG(CAST(q.Version AS FLOAT))          AS avg_version,
          MAX(q.Version)                         AS max_version
        FROM dbo.Quotation q
        ${whereClause}
        GROUP BY ${periodExpr}
        ORDER BY period ASC
      `);

      trendData = trendResult.recordset.map(r => ({
        period:               r.period,
        so_bao_gia:           r.so_bao_gia,
        trung_binh_chinh_sua: r.avg_version != null
          ? parseFloat((r.avg_version - 1).toFixed(2))
          : null,
        max_chinh_sua:        r.max_version != null ? r.max_version - 1 : null,
      }));
    }

    res.json({
      success:      true,
      filter:       { date_from: dateFrom, date_to: dateTo, group_by: groupBy, sales_rep_id: salesRepId },
      summary,
      by_sales_rep: bySalesRep,
      data:         trendData,
    });
  } catch (err) {
    console.error('[GET /quotations/stats/avg-edit-count]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// 6. GET /api/quotations/stats/by-product
//    Số báo giá theo từng sản phẩm cụ thể
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/quotations/stats/by-product:
 *   get:
 *     summary: "Số báo giá theo sản phẩm"
 *     description: |
 *       Thống kê số lượng báo giá và tổng giá trị theo từng **sản phẩm** cụ thể.
 *       JOIN: `dbo.Quotation` → `dbo.LinkQuotationProduct` → `dbo.Product`.
 *       Hỗ trợ lọc theo `date_from` / `date_to` và giới hạn kết quả bằng `top`.
 *     tags: [Quotations]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/quoteDateFrom'
 *       - $ref: '#/components/parameters/quoteDateTo'
 *       - in: query
 *         name: sort_by
 *         description: "Sắp xếp theo so_bao_gia hoặc tong_gia_tri (mặc định: so_bao_gia)"
 *         schema: { type: string, enum: [so_bao_gia, tong_gia_tri], default: so_bao_gia }
 *     responses:
 *       200:
 *         description: Phân bố báo giá theo sản phẩm
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_san_pham: { type: integer, description: "Số sản phẩm có trong báo giá" }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       product_id:       { type: string }
 *                       ten_san_pham:     { type: string }
 *                       ma_san_pham:      { type: string }
 *                       so_bao_gia:       { type: integer, description: "Số báo giá chứa sản phẩm này" }
 *                       tong_so_luong:    { type: number,  description: "Tổng số lượng trong tất cả báo giá" }
 *                       tong_gia_tri:     { type: number,  description: "Tổng thành tiền (VNĐ)" }
 *                       trung_binh_don_gia: { type: number }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/by-product', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const sortBy   = req.query.sort_by === 'tong_gia_tri' ? 'tong_gia_tri' : 'so_bao_gia';

    // WHERE áp dụng trên Quotation
    const conds = ['q.TrangThai != 0'];
    if (dateFrom) conds.push(`q.NgayTao >= @dateFrom`);
    if (dateTo)   conds.push(`q.NgayTao <= @dateTo`);
    const whereClause = `WHERE ${conds.join(' AND ')}`;

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });

    const result = await request.query(`
      SELECT
        p.Id                                        AS product_id,
        ISNULL(p.TenSanPham, N'Không xác định')     AS ten_san_pham,
        ISNULL(p.SKU, '')                            AS ma_san_pham,
        COUNT(DISTINCT q.Id)                         AS so_bao_gia,
        ISNULL(SUM(lqp.SoLuong), 0)                 AS tong_so_luong,
        ISNULL(SUM(CAST(lqp.GiaBan AS FLOAT) * lqp.SoLuong), 0)  AS tong_gia_tri,
        ISNULL(AVG(CAST(lqp.GiaBan AS FLOAT)), 0)   AS trung_binh_don_gia
      FROM dbo.Quotation q
      INNER JOIN dbo.LinkQuotationProduct lqp ON lqp.QuotationId = q.Id
      INNER JOIN dbo.Product p                ON lqp.ProductId   = p.Id
      ${whereClause}
      GROUP BY p.Id, p.TenSanPham, p.SKU
      ORDER BY ${sortBy} DESC
    `);

    res.json({
      success:        true,
      filter:         { date_from: dateFrom, date_to: dateTo, sort_by: sortBy },
      tong_san_pham:  result.recordset.length,
      data:           result.recordset,
    });
  } catch (err) {
    console.error('[GET /quotations/stats/by-product]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. GET /api/quotations/stats/by-product-group
//    Số báo giá theo nhóm sản phẩm (Taxonomy cha)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/quotations/stats/by-product-group:
 *   get:
 *     summary: "Số báo giá theo nhóm sản phẩm (Taxonomy)"
 *     description: |
 *       Thống kê số lượng báo giá và tổng giá trị theo **nhóm sản phẩm cha** (Taxonomy).
 *       JOIN: `dbo.Quotation` → `dbo.LinkQuotationProduct` → `dbo.Product` → `dbo.Taxonomy` (nhóm cha).
 *       Sản phẩm không thuộc nhóm nào sẽ được gom vào `Không xác định`.
 *       Hỗ trợ tham số `level` để xem theo nhóm cha (`parent`) hoặc nhóm con (`child`).
 *     tags: [Quotations]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/quoteDateFrom'
 *       - $ref: '#/components/parameters/quoteDateTo'
 *       - in: query
 *         name: level
 *         description: "parent = nhóm cha; child = nhóm con trực tiếp (mặc định: parent)"
 *         schema: { type: string, enum: [parent, child], default: parent }
 *     responses:
 *       200:
 *         description: Phân bố báo giá theo nhóm sản phẩm
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_bao_gia: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       group_id:      { type: string }
 *                       ten_nhom:      { type: string }
 *                       so_bao_gia:    { type: integer }
 *                       tong_so_luong: { type: number }
 *                       tong_gia_tri:  { type: number }
 *                       ti_le:         { type: number, description: "% trên tổng số báo giá" }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/by-product-group', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const level    = req.query.level === 'child' ? 'child' : 'parent';

    // WHERE áp dụng trên Quotation
    const conds = ['q.TrangThai != 0'];
    if (dateFrom) conds.push(`q.NgayTao >= @dateFrom`);
    if (dateTo)   conds.push(`q.NgayTao <= @dateTo`);
    const whereClause = `WHERE ${conds.join(' AND ')}`;

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });

    // Dùng subquery để GROUP BY trên cột đơn giản, tránh lỗi expression phức tạp
    let innerGroupIdExpr, innerGroupNameExpr;
    if (level === 'child') {
      innerGroupIdExpr   = `CAST(tn.Id AS NVARCHAR(50))`;
      innerGroupNameExpr = `tn.TieuDe`;
    } else {
      // Ưu tiên nhóm cha (tnp), fallback sang nhóm con (tn)
      innerGroupIdExpr   = `CAST(ISNULL(tnp.Id, tn.Id) AS NVARCHAR(50))`;
      innerGroupNameExpr = `ISNULL(tnp.TieuDe, tn.TieuDe)`;
    }

    const result = await request.query(`
      SELECT
        ISNULL(sub.group_id,   'unknown')          AS group_id,
        ISNULL(sub.ten_nhom,   N'Không xác định') AS ten_nhom,
        COUNT(DISTINCT sub.quotation_id)            AS so_bao_gia,
        ISNULL(SUM(sub.so_luong), 0)               AS tong_so_luong,
        ISNULL(SUM(sub.gia_tri), 0)                AS tong_gia_tri
      FROM (
        SELECT
          q.Id                                                          AS quotation_id,
          ${innerGroupIdExpr}                                           AS group_id,
          ${innerGroupNameExpr}                                         AS ten_nhom,
          lqp.SoLuong                                                   AS so_luong,
          CAST(lqp.GiaBan AS FLOAT) * lqp.SoLuong                      AS gia_tri
        FROM dbo.Quotation q
        INNER JOIN dbo.LinkQuotationProduct lqp ON lqp.QuotationId = q.Id
        INNER JOIN dbo.Product p                ON lqp.ProductId   = p.Id
        LEFT  JOIN dbo.Taxonomy tn              ON tn.Id  = p.NhomThietBiId
        LEFT  JOIN dbo.Taxonomy tnp             ON tnp.Id = tn.KhoaChaId
        ${whereClause}
      ) sub
      GROUP BY sub.group_id, sub.ten_nhom
      ORDER BY so_bao_gia DESC
    `);

    const tong_bao_gia = result.recordset.reduce((s, r) => s + (r.so_bao_gia || 0), 0);

    const data = result.recordset.map(r => ({
      ...r,
      ti_le: tong_bao_gia > 0
        ? parseFloat(((r.so_bao_gia / tong_bao_gia) * 100).toFixed(2))
        : 0,
    }));

    res.json({
      success:      true,
      filter:       { date_from: dateFrom, date_to: dateTo, level },
      tong_bao_gia,
      data,
    });
  } catch (err) {
    console.error('[GET /quotations/stats/by-product-group]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;



