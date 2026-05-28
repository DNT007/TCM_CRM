const express = require('express');
const router  = express.Router();
const { sql, getPool } = require('../db');

/**
 * @swagger
 * tags:
 *   name: Leads
 *   description: Quản lý & phân tích Lead (dbo.Lead)
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
 *     dateFrom:
 *       in: query
 *       name: date_from
 *       schema: { type: string, format: date }
 *       example: "2024-01-01"
 *     dateTo:
 *       in: query
 *       name: date_to
 *       schema: { type: string, format: date }
 *       example: "2024-12-31"
 */

// ══════════════════════════════════════════════════════════════════════════════
// 1. GET /api/leads/stats/by-time
//    Số lead theo thời gian (ngày / tuần / tháng)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/leads/stats/by-time:
 *   get:
 *     summary: "Số lead theo thời gian (ngày / tuần / tháng)"
 *     tags: [Leads]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/dateFrom'
 *       - $ref: '#/components/parameters/dateTo'
 *       - in: query
 *         name: group_by
 *         description: Nhóm theo ngày, tuần hoặc tháng
 *         schema: { type: string, enum: [day, week, month], default: month }
 *     responses:
 *       200:
 *         description: Số lượng lead theo kỳ thời gian
 */
router.get('/stats/by-time', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || 'month'; // day | week | month

    let periodExpr;
    if (groupBy === 'day') {
      periodExpr = `FORMAT(l.NgayTao, 'yyyy-MM-dd')`;
    } else if (groupBy === 'week') {
      periodExpr = `CONCAT(YEAR(l.NgayTao), '-W', RIGHT('00' + CAST(DATEPART(isowk, l.NgayTao) AS VARCHAR(2)), 2))`;
    } else {
      periodExpr = `FORMAT(l.NgayTao, 'yyyy-MM')`;
    }

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });
    const where = buildWhere('l', { dateFrom, dateTo });

    const result = await request.query(`
      SELECT
        ${periodExpr}  AS period,
        COUNT(l.Id)    AS tong_lead
      FROM dbo.Lead l
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
    console.error('[GET /leads/stats/by-time]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. GET /api/leads/stats/by-source
//    Số lead theo nguồn (web, event, referral, cold…)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/leads/stats/by-source:
 *   get:
 *     summary: "Số lead theo nguồn (web, event, referral, cold…)"
 *     tags: [Leads]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/dateFrom'
 *       - $ref: '#/components/parameters/dateTo'
 *     responses:
 *       200:
 *         description: Phân bố lead theo nguồn
 */
router.get('/stats/by-source', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });
    const where = buildWhere('l', { dateFrom, dateTo });

    // Map cứng toàn bộ node con → nhóm cha bằng CASE WHEN
    const result = await request.query(`
      SELECT
        src.ten_nguon,
        COUNT(src.LeadId) AS tong_lead
      FROM (
        SELECT
          l.Id AS LeadId,
          CASE
            -- ── Website ──────────────────────────────────────────────────────
            WHEN t.TieuDe IN (
              N'Website',
              N'tecostore.vn', N'dealer.ingcostore.vn',
              N'tecotec.com.vn', N'ingcovietnam.vn',
              N'Chat box', N'Hotline', N'Email', N'Giỏ hàng',
              N'Google Ads', N'Zalo Chat', N'Zalo OA',
              N'Đề nghị báo giá (Header)', N'Đề nghị báo giá (Products)',
              N'LP-INGCO#Dụng cụ bảo hộ',
              N'LP-INGCO#Máy cầm tay dùng pin',
              N'LP-INGCO#Máy cầm tay dùng điện',
              N'LP-INGCO#Dụng cụ làm vườn',
              N'LP-INGCO#Dụng cụ đo lường',
              N'LP-INGCO#Máy hàn và dụng cụ',
              N'LP-INGCO#Bộ dụng cụ sửa chữa',
              N'LP-INGCO#Dụng cụ sơn',
              N'LP-INGCO#Túi đựng đồ nghề'
            ) THEN N'Website'
            -- ── Sale ─────────────────────────────────────────────────────────
            WHEN t.TieuDe IN (
              N'Sale', N'Seeding', N'Sale tự kiếm', N'Dealer'
            ) THEN N'Sale'
            -- ── Zalo ─────────────────────────────────────────────────────────
            WHEN t.TieuDe IN (
              N'Zalo', N'Zalo Listening', N'Zalo Seeding'
            ) THEN N'Zalo'
            -- ── Facebook ─────────────────────────────────────────────────────
            WHEN t.TieuDe IN (
              N'Facebook', N'Facebook Page', N'Facebook Seeding',
              N'Facebook Ads', N'Facebook Listening'
            ) THEN N'Facebook'
            -- ── Sàn TMDT ─────────────────────────────────────────────────────
            WHEN t.TieuDe IN (
              N'Sàn TMDT', N'Shopee', N'Lazada', N'Sendo', N'Tiki', N'Tiktok'
            ) THEN N'Sàn TMDT'
            -- ── Youtube ──────────────────────────────────────────────────────
            WHEN t.TieuDe IN (
              N'Youtube', N'E&PHCM22'
            ) THEN N'Youtube'
            -- ── Events ───────────────────────────────────────────────────────
            WHEN t.TieuDe IN (
              N'Events', N'Triển lãm', N'MTAHCM22', N'E&PVNhcm22',
              N'MTAHN22', N'TB Đào Tạo - VT22', N'HMIP2022',
              N'VIMEXPO HN22', N'VIETBUILD23'
            ) THEN N'Events'
            -- ── Showroom TKX ─────────────────────────────────────────────────
            WHEN t.TieuDe = N'Showroom TKX' THEN N'Showroom TKX'
            -- ── Không xác định ───────────────────────────────────────────────
            ELSE N'Không xác định'
          END AS ten_nguon
        FROM dbo.Lead l
        LEFT JOIN dbo.Taxonomy t ON l.SourceId = t.Id AND t.TaxonomyType = 3
        ${where}
      ) AS src
      GROUP BY src.ten_nguon
      ORDER BY tong_lead DESC
    `);

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      data:    result.recordset,
    });
  } catch (err) {
    console.error('[GET /leads/stats/by-source]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. GET /api/leads/stats/by-area
//    Số lead theo tỉnh / thành phố
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/leads/stats/by-area:
 *   get:
 *     summary: "Số lead theo tỉnh / thành phố"
 *     tags: [Leads]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/dateFrom'
 *       - $ref: '#/components/parameters/dateTo'
 *     responses:
 *       200:
 *         description: Phân bố lead theo tỉnh/thành
 */
router.get('/stats/by-area', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });
    const where = buildWhere('l', { dateFrom, dateTo });

    const queryStr = `
      SELECT
        ISNULL(t.TieuDe, N'Không xác định') AS tinh_thanh,
        t.Id                                  AS area_id,
        COUNT(l.Id)                           AS tong_lead
      FROM dbo.Lead l
      LEFT JOIN dbo.RawCustomer rc ON rc.Id = l.RawCustomerId
      LEFT JOIN dbo.Taxonomy t     ON t.Id  = rc.AreaId AND t.TaxonomyType = 1
      ${where}
      GROUP BY t.TieuDe, t.Id
      ORDER BY tong_lead DESC
      OPTION (RECOMPILE)
    `;
    const result = await request.query(queryStr);

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      data:    result.recordset,
    });
  } catch (err) {
    console.error('[GET /leads/stats/by-area]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// 4. GET /api/leads/stats/by-industry
//    Số lead theo ngành hàng / nhóm khách hàng
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/leads/stats/by-industry:
 *   get:
 *     summary: "Số lead theo ngành hàng / nhóm khách hàng (ClassifyType)"
 *     tags: [Leads]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/dateFrom'
 *       - $ref: '#/components/parameters/dateTo'
 *     responses:
 *       200:
 *         description: Phân bố lead theo ngành hàng
 */
router.get('/stats/by-industry', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });
    const where = buildWhere('l', { dateFrom, dateTo });

    const result = await request.query(`
      SELECT
        CASE c.ClassifyType 
          WHEN 1 THEN N'Doanh nghiệp'
          WHEN 2 THEN N'Cá nhân'
          ELSE N'Không xác định'
        END AS nganh_hang,
        COUNT(l.Id) AS tong_lead
      FROM dbo.Lead l
      LEFT JOIN dbo.Customer c ON c.Id = COALESCE(l.PartnerId, l.ContactId)
      ${where}
      GROUP BY c.ClassifyType
      ORDER BY tong_lead DESC
    `);

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      data:    result.recordset,
    });
  } catch (err) {
    console.error('[GET /leads/stats/by-industry]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. GET /api/leads/stats/by-sales-rep
//    Số lead theo sales rep (người phụ trách)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/leads/stats/by-sales-rep:
 *   get:
 *     summary: "Số lead theo sales rep / người phụ trách"
 *     tags: [Leads]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/dateFrom'
 *       - $ref: '#/components/parameters/dateTo'
 *     responses:
 *       200:
 *         description: Phân bố lead theo nhân viên phụ trách
 */
router.get('/stats/by-sales-rep', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });
    const where = buildWhere('l', { dateFrom, dateTo });

    const result = await request.query(`
      SELECT
        l.NguoiXuLyId                                   AS sales_rep_id,
        ISNULL(u.FullName, N'Chưa phân công')           AS FullName,
        ISNULL(u.UserName, '')                           AS UserName,
        COUNT(l.Id)                                      AS tong_lead
      FROM dbo.Lead l
      LEFT JOIN dbo.[UserFunction] u ON l.NguoiXuLyId = u.UserId
      ${where}
      GROUP BY l.NguoiXuLyId, u.FullName, u.UserName
      ORDER BY tong_lead DESC
    `);

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      data:    result.recordset,
    });
  } catch (err) {
    console.error('[GET /leads/stats/by-sales-rep]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. GET /api/leads/stats/by-status
//    Số lead theo trạng thái (New, Quality, Opty, Quotation, Process, Finshed)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/leads/stats/by-status:
 *   get:
 *     summary: "Số lead theo trạng thái (New, Quality, Opty, Quotation, Process, FinshedOPPORTUNITY)"
 *     tags: [Leads]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/dateFrom'
 *       - $ref: '#/components/parameters/dateTo'
 *     responses:
 *       200:
 *         description: Phân bố lead theo từng trạng thái TinhTrang
 */
router.get('/stats/by-status', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });
    const where = buildWhere('l', { dateFrom, dateTo });

    // Map TinhTrang code → nhãn tiếng Việt (tuỳ chỉnh theo DB thực tế)
    const result = await request.query(`
      SELECT
        l.TinhTrang AS tinh_trang_code,
        CASE l.TinhTrang
          WHEN 1 THEN N'New'
          WHEN 2 THEN N'Quality'
          WHEN 3 THEN N'Opty'
          WHEN 4 THEN N'Quotation'
          WHEN 5 THEN N'Process'
          WHEN 6 THEN N'Finshed'
          ELSE N'Khác'
        END         AS tinh_trang_label,
        COUNT(l.Id) AS tong_lead
      FROM dbo.Lead l
      ${where}
      GROUP BY l.TinhTrang
      ORDER BY l.TinhTrang ASC
    `);

    // Tổng summary nhanh
    const summaryMap = { New: 0, Quality: 0, Opty: 0, Quotation: 0, Process: 0, Finshed: 0, khac: 0 };
    result.recordset.forEach(row => {
      if (row.tinh_trang_code === 1) summaryMap.New         += row.tong_lead;
      else if (row.tinh_trang_code === 2) summaryMap.Quality  += row.tong_lead;
      else if (row.tinh_trang_code === 3) summaryMap.Opty  += row.tong_lead;
      else if (row.tinh_trang_code === 4) summaryMap.Quotation    += row.tong_lead;
      else if (row.tinh_trang_code === 5) summaryMap.Process  += row.tong_lead;
      else if (row.tinh_trang_code === 6) summaryMap.Finshed  += row.tong_lead;
      else summaryMap.khac += row.tong_lead;
    });

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      summary: summaryMap,
      data:    result.recordset,
    });
  } catch (err) {
    console.error('[GET /leads/stats/by-status]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. GET /api/leads/stats/qualified-rate
//    Tỉ lệ lead qualified vs unqualified theo thời gian
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/leads/stats/qualified-rate:
 *   get:
 *     summary: "Tỉ lệ lead qualified vs unqualified theo thời gian"
 *     tags: [Leads]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/dateFrom'
 *       - $ref: '#/components/parameters/dateTo'
 *       - in: query
 *         name: group_by
 *         schema: { type: string, enum: [day, week, month], default: month }
 *     responses:
 *       200:
 *         description: Tỉ lệ qualified / unqualified theo kỳ và tổng cộng
 */
router.get('/stats/qualified-rate', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || 'month';

    let periodExpr;
    if (groupBy === 'day') {
      periodExpr = `FORMAT(l.NgayTao, 'yyyy-MM-dd')`;
    } else if (groupBy === 'week') {
      periodExpr = `CONCAT(YEAR(l.NgayTao), '-W', RIGHT('00' + CAST(DATEPART(isowk, l.NgayTao) AS VARCHAR(2)), 2))`;
    } else {
      periodExpr = `FORMAT(l.NgayTao, 'yyyy-MM')`;
    }

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });
    const where = buildWhere('l', { dateFrom, dateTo });

    const byTime = await request.query(`
      SELECT
        ${periodExpr}                                      AS period,
        COUNT(l.Id)                                        AS tong_lead,
        SUM(CASE WHEN l.TinhTrang = 3 THEN 1 ELSE 0 END)  AS so_qualified,
        SUM(CASE WHEN l.TinhTrang = 4 THEN 1 ELSE 0 END)  AS so_unqualified,
        CAST(
          ROUND(
            100.0 * SUM(CASE WHEN l.TinhTrang = 3 THEN 1 ELSE 0 END)
              / NULLIF(COUNT(l.Id), 0),
          2) AS DECIMAL(5,2)
        )                                                  AS ty_le_qualified_pct,
        CAST(
          ROUND(
            100.0 * SUM(CASE WHEN l.TinhTrang = 4 THEN 1 ELSE 0 END)
              / NULLIF(COUNT(l.Id), 0),
          2) AS DECIMAL(5,2)
        )                                                  AS ty_le_unqualified_pct
      FROM dbo.Lead l
      ${where}
      GROUP BY ${periodExpr}
      ORDER BY period ASC
    `);

    // Tổng cộng toàn kỳ
    const summaryReq = pool.request();
    addDateParams(summaryReq, { dateFrom, dateTo });
    const summary = await summaryReq.query(`
      SELECT
        COUNT(l.Id)                                        AS tong_lead,
        SUM(CASE WHEN l.TinhTrang = 3 THEN 1 ELSE 0 END)  AS tong_qualified,
        SUM(CASE WHEN l.TinhTrang = 4 THEN 1 ELSE 0 END)  AS tong_unqualified,
        CAST(
          ROUND(
            100.0 * SUM(CASE WHEN l.TinhTrang = 3 THEN 1 ELSE 0 END)
              / NULLIF(COUNT(l.Id), 0),
          2) AS DECIMAL(5,2)
        )                                                  AS ty_le_qualified_pct,
        CAST(
          ROUND(
            100.0 * SUM(CASE WHEN l.TinhTrang = 4 THEN 1 ELSE 0 END)
              / NULLIF(COUNT(l.Id), 0),
          2) AS DECIMAL(5,2)
        )                                                  AS ty_le_unqualified_pct
      FROM dbo.Lead l
      ${buildWhere('l', { dateFrom, dateTo })}
    `);

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, group_by: groupBy },
      summary: summary.recordset[0],
      data:    byTime.recordset,
    });
  } catch (err) {
    console.error('[GET /leads/stats/qualified-rate]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Các route CRUD cơ bản (giữ nguyên)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/leads:
 *   get:
 *     summary: Danh sách leads (có phân trang, tìm kiếm)
 *     tags: [Leads]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - $ref: '#/components/parameters/dateFrom'
 *       - $ref: '#/components/parameters/dateTo'
 *       - in: query
 *         name: search
 *         description: Tìm theo tên, email, điện thoại
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Danh sách leads với phân trang
 */
router.get('/', async (req, res) => {
  try {
    const pool   = getPool();
    const page   = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit  = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const search   = req.query.search    ? `%${req.query.search}%` : null;

    const conditions = ['l.TrangThai = 1'];
    const request = pool.request()
      .input('limit',  sql.Int, limit)
      .input('offset', sql.Int, offset);

    if (dateFrom) { conditions.push('l.NgayCapNhat >= @dateFrom'); request.input('dateFrom', sql.DateTime, new Date(dateFrom)); }
    if (dateTo)   { conditions.push('l.NgayCapNhat <= @dateTo');   request.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59')); }
    if (search)   { conditions.push('(l.TenKhachHang LIKE @search OR l.Email LIKE @search OR l.DienThoai LIKE @search)'); request.input('search', sql.NVarChar, search); }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countReq = pool.request();
    if (dateFrom) countReq.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo)   countReq.input('dateTo',   sql.DateTime, new Date(dateTo + 'T23:59:59'));
    if (search)   countReq.input('search',   sql.NVarChar, search);

    const [countResult, dataResult] = await Promise.all([
      countReq.query(`SELECT COUNT(*) AS total FROM dbo.Lead l ${where}`),
      request.query(`
        SELECT
          l.Id, l.TenKhachHang, l.Email, l.DienThoai, l.CongTy,
          l.SourceId, l.TinhTrang, l.TrangThai,
          CASE l.TinhTrang
            WHEN 1 THEN N'Mới'
            WHEN 2 THEN N'Đang xử lý'
            WHEN 3 THEN N'Đã qualify'
            WHEN 4 THEN N'Đã loại'
            WHEN 5 THEN N'Chuyển đổi'
            ELSE N'Khác'
          END AS tinh_trang_label,
          l.NguoiTaoId, l.NgayTao, l.NguoiCapNhatId, l.NgayCapNhat
        FROM dbo.Lead l
        ${where}
        ORDER BY l.NgayCapNhat DESC
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
    console.error('[GET /leads]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @swagger
 * /api/leads/{id}:
 *   get:
 *     summary: Chi tiết một lead
 *     tags: [Leads]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Chi tiết lead
 *       404:
 *         description: Không tìm thấy
 */
router.get('/:id', async (req, res) => {
  try {
    const pool   = getPool();
    const result = await pool.request()
      .input('id', sql.BigInt, parseInt(req.params.id))
      .query(`
        SELECT *,
          CASE TinhTrang
            WHEN 1 THEN N'Mới'
            WHEN 2 THEN N'Đang xử lý'
            WHEN 3 THEN N'Đã qualify'
            WHEN 4 THEN N'Đã loại'
            WHEN 5 THEN N'Chuyển đổi'
            ELSE N'Khác'
          END AS tinh_trang_label
        FROM dbo.Lead 
        WHERE Id = @id
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy lead' });
    }
    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    console.error('[GET /leads/:id]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
