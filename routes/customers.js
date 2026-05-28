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

// ══════════════════════════════════════════════════════════════════════════════
// STATS 1. GET /api/customers/stats/by-time
//    Số khách hàng mới theo thời gian
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/customers/stats/by-time:
 *   get:
 *     summary: "Số khách hàng mới theo thời gian"
 *     description: |
 *       Thống kê số lượng khách hàng mới được tạo theo kỳ thời gian.
 *       - Lọc ngày theo `Customer.NgayTao`.
 *       - Hỗ trợ `group_by` (day | week | month) để phân kỳ.
 *       - Trả về tổng (`tong_khach_hang`) và mảng `data` phân kỳ (khi có `group_by`).
 *     tags: [Customers]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *         description: Lọc từ ngày (yyyy-MM-dd)
 *         example: "2024-01-01"
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *         description: Lọc đến ngày (yyyy-MM-dd)
 *         example: "2024-12-31"
 *       - in: query
 *         name: group_by
 *         description: Nhóm theo thời gian (day | week | month)
 *         schema: { type: string, enum: [day, week, month] }
 *     responses:
 *       200:
 *         description: Thống kê khách hàng mới theo thời gian
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_khach_hang: { type: integer, description: "Tổng số KH mới trong khoảng lọc" }
 *                 data:
 *                   type: array
 *                   description: Phân bổ theo kỳ thời gian (chỉ có khi truyền group_by)
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:          { type: string }
 *                       so_khach_hang:   { type: integer }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/by-time', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || null;

    const dateExtra = buildDateWhere('c', 'NgayTao', { dateFrom, dateTo }, ['c.TrangThai = 1']);

    // ── Tổng khách hàng ───────────────────────────────────────────────────────
    const reqSum = pool.request();
    addDateParams(reqSum, { dateFrom, dateTo });

    const sumResult = await reqSum.query(`
      SELECT COUNT(c.Id) AS tong_khach_hang
      FROM dbo.Customer c
      WHERE ${dateExtra.replace(/^AND /, '')}
    `);

    const tongKhachHang = sumResult.recordset[0].tong_khach_hang;

    // ── Xu hướng theo kỳ ─────────────────────────────────────────────────────
    let trendData = [];
    if (groupBy) {
      const periodExpr = buildPeriodExpr('c', 'NgayTao', groupBy);
      const reqTrend   = pool.request();
      addDateParams(reqTrend, { dateFrom, dateTo });

      const trendResult = await reqTrend.query(`
        SELECT
          ${periodExpr}      AS period,
          COUNT(c.Id)        AS so_khach_hang
        FROM dbo.Customer c
        WHERE ${dateExtra.replace(/^AND /, '')}
        GROUP BY ${periodExpr}
        ORDER BY period ASC
      `);

      trendData = trendResult.recordset.map(r => ({
        period:        r.period,
        so_khach_hang: r.so_khach_hang,
      }));
    }

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, group_by: groupBy },
      tong_khach_hang: tongKhachHang,
      data: trendData,
    });
  } catch (err) {
    console.error('[GET /customers/stats/by-time]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// STATS 2. GET /api/customers/stats/by-province
//    Số khách hàng theo tỉnh/thành phố
//    JOIN: Customer.AreaId → dbo.Taxonomy (TaxonomyType = 1 = tỉnh/thành phố)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/customers/stats/by-province:
 *   get:
 *     summary: "Số khách hàng theo tỉnh/thành phố"
 *     description: |
 *       Thống kê số lượng khách hàng phân theo tỉnh/thành phố.
 *       - Tỉnh/thành phố lấy từ `Customer.AreaId` JOIN `dbo.Taxonomy` (`TaxonomyType = 1`).
 *       - Hỗ trợ lọc khoảng thời gian tạo (`NgayTao`).
 *       - Kết quả sắp xếp giảm dần theo số khách hàng.
 *       - Các khách hàng chưa chọn tỉnh/thành sẽ được nhóm vào `"Không xác định"`.
 *     tags: [Customers]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *         description: Lọc từ ngày (yyyy-MM-dd)
 *         example: "2024-01-01"
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *         description: Lọc đến ngày (yyyy-MM-dd)
 *         example: "2024-12-31"
 *     responses:
 *       200:
 *         description: Thống kê khách hàng theo tỉnh/thành phố
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_khach_hang: { type: integer, description: "Tổng số KH trong khoảng lọc" }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       area_id:         { type: integer, description: "ID tỉnh/thành (Taxonomy.Id)" }
 *                       tinh_thanh:      { type: string,  description: "Tên tỉnh/thành phố", example: "Thành phố Hà Nội" }
 *                       so_khach_hang:   { type: integer, description: "Số khách hàng" }
 *                       ti_le_phan_tram: { type: number,  description: "Tỉ lệ % trên tổng" }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/by-province', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const dateExtra = buildDateWhere('c', 'NgayTao', { dateFrom, dateTo }, ['c.TrangThai = 1']);

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });

    // JOIN Customer.AreaId → Taxonomy để lấy tên tỉnh/thành phố chuẩn hóa
    const result = await request.query(`
      SELECT
        c.AreaId                             AS area_id,
        ISNULL(t.TieuDe, N'Không xác định') AS tinh_thanh,
        COUNT(c.Id)                          AS so_khach_hang
      FROM dbo.Customer c
      LEFT JOIN dbo.Taxonomy t ON t.Id = c.AreaId
      WHERE ${dateExtra.replace(/^AND /, '')}
      GROUP BY c.AreaId, ISNULL(t.TieuDe, N'Không xác định')
      ORDER BY so_khach_hang DESC
    `);

    const tongKhachHang = result.recordset.reduce((s, r) => s + (r.so_khach_hang || 0), 0);

    const data = result.recordset.map(r => ({
      area_id:         r.area_id,
      tinh_thanh:      r.tinh_thanh,
      so_khach_hang:   r.so_khach_hang,
      ti_le_phan_tram: tongKhachHang > 0
        ? parseFloat(((r.so_khach_hang / tongKhachHang) * 100).toFixed(2))
        : 0,
    }));

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      tong_khach_hang: tongKhachHang,
      data,
    });
  } catch (err) {
    console.error('[GET /customers/stats/by-province]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// STATS 3. GET /api/customers/stats/by-group
//    Số khách hàng theo nhóm / ngành
//
//    JOIN sử dụng:
//      • dbo.Customer            — bảng chính
//      • (không JOIN thêm)       — dùng trực tiếp Customer.ClassifyType
//                                  (1=Cá nhân, 2=Công ty/Doanh nghiệp)
//                                  và Customer.CustomerType
//                                  (1=Khách hàng, 2=Đại lý/Partner)
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/customers/stats/by-group:
 *   get:
 *     summary: "Số khách hàng theo nhóm / loại"
 *     description: |
 *       Thống kê số lượng khách hàng phân theo nhóm/loại từ các trường nội bộ:
 *       - **`ClassifyType`**: phân loại hình thức KH — `1 = Cá nhân`, `2 = Công ty / Doanh nghiệp`.
 *       - **`CustomerType`**: loại mối quan hệ — `1 = Khách hàng thường`, `2 = Đại lý / Partner`.
 *       - Kết quả gồm 2 mảng `by_classify_type` và `by_customer_type`, mỗi mảng có `so_luong` và `ti_le`.
 *       - Hỗ trợ lọc theo `date_from` / `date_to` (theo `Customer.NgayTao`).
 *
 *       **Bảng JOIN**: chỉ dùng `dbo.Customer`.
 *     tags: [Customers]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *         description: Lọc từ ngày (yyyy-MM-dd)
 *         example: "2024-01-01"
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *         description: Lọc đến ngày (yyyy-MM-dd)
 *         example: "2024-12-31"
 *     responses:
 *       200:
 *         description: Thống kê KH theo nhóm / loại
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 filter:  { type: object }
 *                 tong_khach_hang: { type: integer }
 *                 by_classify_type:
 *                   type: array
 *                   description: Phân loại hình thức (cá nhân / công ty)
 *                   items:
 *                     type: object
 *                     properties:
 *                       classify_type:   { type: integer, description: "1=Cá nhân | 2=Công ty" }
 *                       ten_loai:        { type: string,  description: "Tên nhóm" }
 *                       so_luong:        { type: integer }
 *                       ti_le_phan_tram: { type: number }
 *                 by_customer_type:
 *                   type: array
 *                   description: Phân loại mối quan hệ (KH thường / Đại lý)
 *                   items:
 *                     type: object
 *                     properties:
 *                       customer_type:   { type: integer, description: "1=Khách hàng | 2=Đại lý/Partner" }
 *                       ten_loai:        { type: string }
 *                       so_luong:        { type: integer }
 *                       ti_le_phan_tram: { type: number }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/by-group', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const dateExtra = buildDateWhere('c', 'NgayTao', { dateFrom, dateTo }, ['c.TrangThai = 1']);
    const whereSQL  = `WHERE ${dateExtra.replace(/^AND /, '')}`;

    // Map ClassifyType & CustomerType → tên hiển thị
    const CLASSIFY_MAP  = { 1: 'Cá nhân', 2: 'Công ty / Doanh nghiệp' };
    const CUSTOMER_MAP  = { 0: 'Không xác định', 1: 'Khách hàng', 2: 'Đại lý / Partner' };

    const req1 = pool.request();
    const req2 = pool.request();
    addDateParams(req1, { dateFrom, dateTo });
    addDateParams(req2, { dateFrom, dateTo });

    const [r1, r2] = await Promise.all([
      req1.query(`
        SELECT ClassifyType, COUNT(c.Id) AS so_luong
        FROM dbo.Customer c ${whereSQL}
        GROUP BY ClassifyType ORDER BY ClassifyType
      `),
      req2.query(`
        SELECT CustomerType, COUNT(c.Id) AS so_luong
        FROM dbo.Customer c ${whereSQL}
        GROUP BY CustomerType ORDER BY CustomerType
      `),
    ]);

    const tongKhachHang = r1.recordset.reduce((s, r) => s + (r.so_luong || 0), 0);

    const byClassify = r1.recordset.map(r => ({
      classify_type:   r.ClassifyType,
      ten_loai:        CLASSIFY_MAP[r.ClassifyType] || `Loại ${r.ClassifyType}`,
      so_luong:        r.so_luong,
      ti_le_phan_tram: tongKhachHang > 0
        ? parseFloat(((r.so_luong / tongKhachHang) * 100).toFixed(2))
        : 0,
    }));

    const byCustomer = r2.recordset.map(r => ({
      customer_type:   r.CustomerType,
      ten_loai:        CUSTOMER_MAP[r.CustomerType] ?? `Loại ${r.CustomerType}`,
      so_luong:        r.so_luong,
      ti_le_phan_tram: tongKhachHang > 0
        ? parseFloat(((r.so_luong / tongKhachHang) * 100).toFixed(2))
        : 0,
    }));

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      tong_khach_hang: tongKhachHang,
      by_classify_type: byClassify,
      by_customer_type: byCustomer,
    });
  } catch (err) {
    console.error('[GET /customers/stats/by-group]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// STATS 4. GET /api/customers/stats/repeat-rate
//    Tỉ lệ khách hàng quay lại (repeat order)
//
//    JOIN sử dụng:
//      • dbo.Customer            — thông tin khách hàng
//      • dbo.Quotation           — JOIN qua Quotation.PartnerId = Customer.Id
//      • dbo.[Order]             — JOIN qua Order.Id = Quotation.Id
//                                  (Order.Id là FK trỏ vào Quotation.Id)
//
//    Logic: Khách "quay lại" = có ≥ 2 Order trong khoảng thời gian lọc
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/customers/stats/repeat-rate:
 *   get:
 *     summary: "Tỉ lệ khách hàng quay lại (repeat order)"
 *     description: |
 *       Tính tỉ lệ khách hàng đặt hàng **từ 2 lần trở lên** (repeat customers) trong khoảng thời gian lọc.
 *
 *       **Định nghĩa**: Khách hàng "quay lại" là khách có **≥ 2 đơn hàng** (`dbo.Order`) được tính.
 *
 *       **Chuỗi JOIN**:
 *       ```
 *       dbo.Customer
 *         ← dbo.Quotation  (Quotation.PartnerId = Customer.Id)
 *         ← dbo.[Order]    (Order.Id = Quotation.Id)
 *       ```
 *
 *       - Lọc ngày theo `Quotation.NgayTao` (ngày tạo báo giá/đơn hàng).
 *       - Trả về tổng KH có đơn, số KH mua 1 lần, số KH mua ≥2 lần, và tỉ lệ %.
 *       - Mảng `top_repeat` liệt kê top 10 KH quay lại nhiều nhất.
 *     tags: [Customers]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *         description: Lọc từ ngày (yyyy-MM-dd)
 *         example: "2024-01-01"
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *         description: Lọc đến ngày (yyyy-MM-dd)
 *         example: "2024-12-31"
 *     responses:
 *       200:
 *         description: Tỉ lệ khách hàng quay lại
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
 *                     tong_kh_co_don:      { type: integer, description: "Tổng KH có ≥1 đơn hàng" }
 *                     kh_mua_1_lan:        { type: integer, description: "KH chỉ mua 1 lần" }
 *                     kh_quay_lai:         { type: integer, description: "KH mua ≥2 lần" }
 *                     ti_le_quay_lai:      { type: number,  description: "% KH quay lại / tổng KH có đơn" }
 *                 top_repeat:
 *                   type: array
 *                   description: Top 10 KH quay lại nhiều nhất
 *                   items:
 *                     type: object
 *                     properties:
 *                       customer_id:   { type: integer }
 *                       TenKhachHang:  { type: string }
 *                       so_don_hang:   { type: integer }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/repeat-rate', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;

    const dateExtra = buildDateWhere('q', 'NgayTao', { dateFrom, dateTo });

    const request = pool.request();
    addDateParams(request, { dateFrom, dateTo });

    // Đếm số đơn hàng trên mỗi KH
    const result = await request.query(`
      SELECT
        q.PartnerId                      AS customer_id,
        c.TenKhachHang,
        COUNT(o.Id)                      AS so_don_hang
      FROM dbo.[Order] o
      INNER JOIN dbo.Quotation q ON q.Id = o.Id
      INNER JOIN dbo.Customer  c ON c.Id = q.PartnerId
      WHERE o.TrangThai = 1
        AND q.PartnerId IS NOT NULL
        AND c.TrangThai = 1
        ${dateExtra}
      GROUP BY q.PartnerId, c.TenKhachHang
      ORDER BY so_don_hang DESC
    `);

    const rows = result.recordset;
    const tongKHCoDon = rows.length;
    const khMua1Lan   = rows.filter(r => r.so_don_hang === 1).length;
    const khQuayLai   = rows.filter(r => r.so_don_hang >= 2).length;

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo },
      summary: {
        tong_kh_co_don: tongKHCoDon,
        kh_mua_1_lan:   khMua1Lan,
        kh_quay_lai:    khQuayLai,
        ti_le_quay_lai: tongKHCoDon > 0
          ? parseFloat(((khQuayLai / tongKHCoDon) * 100).toFixed(2))
          : 0,
      },
      top_repeat: rows.slice(0, 10).map(r => ({
        customer_id:  r.customer_id,
        TenKhachHang: r.TenKhachHang,
        so_don_hang:  r.so_don_hang,
      })),
    });
  } catch (err) {
    console.error('[GET /customers/stats/repeat-rate]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// STATS 5. GET /api/customers/stats/revenue-new-vs-returning
//    Doanh thu từ khách mới vs khách cũ
//
//    JOIN sử dụng:
//      • dbo.Customer            — ngày tạo KH (Customer.NgayTao)
//      • dbo.Quotation           — JOIN qua Quotation.PartnerId = Customer.Id
//                                  → lấy TongGiaTri (doanh thu)
//      • dbo.[Order]             — JOIN qua Order.Id = Quotation.Id
//
//    Logic phân loại:
//      - "Khách MỚI"  = KH lần đầu có đơn hàng TRONG khoảng lọc
//                       (không có đơn hàng nào TRƯỚC date_from)
//      - "Khách CŨ"   = KH đã từng có đơn hàng TRƯỚC khoảng lọc
// ══════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/customers/stats/revenue-new-vs-returning:
 *   get:
 *     summary: "Doanh thu từ khách mới vs khách cũ"
 *     description: |
 *       So sánh doanh thu (`Quotation.TongGiaTri`) giữa **khách mới** và **khách cũ**
 *       trong một khoảng thời gian.
 *
 *       **Định nghĩa**:
 *       - **Khách MỚI**: KH có đơn hàng **trong** khoảng lọc nhưng **không có** đơn hàng nào trước `date_from`.
 *       - **Khách CŨ**: KH đã có đơn hàng **trước** `date_from` và tiếp tục mua trong khoảng lọc.
 *       - Nếu không truyền `date_from`, tất cả KH trong `date_to` được coi là "mới".
 *
 *       **Chuỗi JOIN**:
 *       ```
 *       dbo.Customer
 *         ← dbo.Quotation  (Quotation.PartnerId = Customer.Id)
 *         ← dbo.[Order]    (Order.Id = Quotation.Id)
 *       ```
 *     tags: [Customers]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *         description: Bắt đầu khoảng thời gian phân tích (yyyy-MM-dd)
 *         example: "2024-01-01"
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *         description: Kết thúc khoảng thời gian phân tích (yyyy-MM-dd)
 *         example: "2024-12-31"
 *       - in: query
 *         name: group_by
 *         description: Xem xu hướng theo kỳ (day | week | month)
 *         schema: { type: string, enum: [day, week, month] }
 *     responses:
 *       200:
 *         description: Doanh thu khách mới vs khách cũ
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
 *                     khach_moi:
 *                       type: object
 *                       properties:
 *                         so_khach:      { type: integer }
 *                         doanh_thu:     { type: number,  description: "Tổng doanh thu (VNĐ)" }
 *                         ti_le_dt:      { type: number,  description: "% doanh thu / tổng" }
 *                     khach_cu:
 *                       type: object
 *                       properties:
 *                         so_khach:      { type: integer }
 *                         doanh_thu:     { type: number }
 *                         ti_le_dt:      { type: number }
 *                 data:
 *                   type: array
 *                   description: Xu hướng theo kỳ (chỉ có khi truyền group_by)
 *                   items:
 *                     type: object
 *                     properties:
 *                       period:             { type: string }
 *                       dt_khach_moi:       { type: number }
 *                       dt_khach_cu:        { type: number }
 *                       so_kh_moi:          { type: integer }
 *                       so_kh_cu:           { type: integer }
 *       500:
 *         description: Lỗi server
 */
router.get('/stats/revenue-new-vs-returning', async (req, res) => {
  try {
    const pool     = getPool();
    const dateFrom = req.query.date_from || null;
    const dateTo   = req.query.date_to   || null;
    const groupBy  = req.query.group_by  || null;

    // ── Điều kiện khoảng lọc chính ───────────────────────────────────────────
    const periodConds = ['o.TrangThai = 1', 'q.PartnerId IS NOT NULL', 'c.TrangThai = 1'];
    if (dateFrom) periodConds.push(`q.NgayTao >= @dateFrom`);
    if (dateTo)   periodConds.push(`q.NgayTao <= @dateTo`);
    const periodWhere = `WHERE ${periodConds.join(' AND ')}`;

    // ── Summary ───────────────────────────────────────────────────────────────
    const reqSum = pool.request();
    addDateParams(reqSum, { dateFrom, dateTo });

    // Với mỗi KH trong khoảng lọc: kiểm tra xem họ có đơn nào TRƯỚC dateFrom không
    // Nếu không có → Khách mới; Nếu có → Khách cũ
    const sumResult = await reqSum.query(`
      WITH KhachTrongKy AS (
        SELECT
          q.PartnerId                    AS customer_id,
          SUM(CAST(q.TongGiaTri AS FLOAT)) AS doanh_thu
        FROM dbo.[Order] o
        INNER JOIN dbo.Quotation q ON q.Id = o.Id
        INNER JOIN dbo.Customer  c ON c.Id = q.PartnerId
        ${periodWhere}
        GROUP BY q.PartnerId
      ),
      KhachCoLichSu AS (
        SELECT DISTINCT q2.PartnerId AS customer_id
        FROM dbo.[Order] o2
        INNER JOIN dbo.Quotation q2 ON q2.Id = o2.Id
        WHERE o2.TrangThai = 1
          AND q2.PartnerId IS NOT NULL
          ${dateFrom ? 'AND q2.NgayTao < @dateFrom' : ''}
      )
      SELECT
        CASE WHEN kls.customer_id IS NULL THEN 'new' ELSE 'returning' END AS loai,
        COUNT(*)                  AS so_khach,
        SUM(ktk.doanh_thu)        AS doanh_thu
      FROM KhachTrongKy ktk
      LEFT JOIN KhachCoLichSu kls ON kls.customer_id = ktk.customer_id
      GROUP BY CASE WHEN kls.customer_id IS NULL THEN 'new' ELSE 'returning' END
    `);

    const rows = sumResult.recordset;
    const newRow = rows.find(r => r.loai === 'new')       || { so_khach: 0, doanh_thu: 0 };
    const retRow = rows.find(r => r.loai === 'returning') || { so_khach: 0, doanh_thu: 0 };
    const tongDT = (Number(newRow.doanh_thu) || 0) + (Number(retRow.doanh_thu) || 0);

    const summary = {
      khach_moi: {
        so_khach:  newRow.so_khach,
        doanh_thu: Math.round(Number(newRow.doanh_thu) || 0),
        ti_le_dt:  tongDT > 0 ? parseFloat(((Number(newRow.doanh_thu) / tongDT) * 100).toFixed(2)) : 0,
      },
      khach_cu: {
        so_khach:  retRow.so_khach,
        doanh_thu: Math.round(Number(retRow.doanh_thu) || 0),
        ti_le_dt:  tongDT > 0 ? parseFloat(((Number(retRow.doanh_thu) / tongDT) * 100).toFixed(2)) : 0,
      },
    };

    // ── Xu hướng theo kỳ ─────────────────────────────────────────────────────
    let trendData = [];
    if (groupBy) {
      const periodExpr = buildPeriodExpr('q', 'NgayTao', groupBy);
      const reqTrend   = pool.request();
      addDateParams(reqTrend, { dateFrom, dateTo });

      const trendResult = await reqTrend.query(`
        WITH KhachCoLichSu AS (
          SELECT DISTINCT q2.PartnerId AS customer_id
          FROM dbo.[Order] o2
          INNER JOIN dbo.Quotation q2 ON q2.Id = o2.Id
          WHERE o2.TrangThai = 1 AND q2.PartnerId IS NOT NULL
            ${dateFrom ? 'AND q2.NgayTao < @dateFrom' : ''}
        )
        SELECT
          ${periodExpr}                                              AS period,
          CASE WHEN kls.customer_id IS NULL THEN 'new' ELSE 'returning' END AS loai,
          COUNT(DISTINCT q.PartnerId)                                AS so_khach,
          SUM(CAST(q.TongGiaTri AS FLOAT))                          AS doanh_thu
        FROM dbo.[Order] o
        INNER JOIN dbo.Quotation q ON q.Id = o.Id
        INNER JOIN dbo.Customer  c ON c.Id = q.PartnerId
        LEFT  JOIN KhachCoLichSu kls ON kls.customer_id = q.PartnerId
        ${periodWhere}
        GROUP BY ${periodExpr}, CASE WHEN kls.customer_id IS NULL THEN 'new' ELSE 'returning' END
        ORDER BY period ASC, loai
      `);

      // Pivot về dạng 1 row per period
      const periodMap = {};
      for (const r of trendResult.recordset) {
        if (!periodMap[r.period]) {
          periodMap[r.period] = { period: r.period, dt_khach_moi: 0, dt_khach_cu: 0, so_kh_moi: 0, so_kh_cu: 0 };
        }
        if (r.loai === 'new') {
          periodMap[r.period].dt_khach_moi = Math.round(Number(r.doanh_thu) || 0);
          periodMap[r.period].so_kh_moi    = r.so_khach;
        } else {
          periodMap[r.period].dt_khach_cu  = Math.round(Number(r.doanh_thu) || 0);
          periodMap[r.period].so_kh_cu     = r.so_khach;
        }
      }
      trendData = Object.values(periodMap).sort((a, b) => a.period.localeCompare(b.period));
    }

    res.json({
      success: true,
      filter:  { date_from: dateFrom, date_to: dateTo, group_by: groupBy },
      tong_doanh_thu: Math.round(tongDT),
      summary,
      data: trendData,
    });
  } catch (err) {
    console.error('[GET /customers/stats/revenue-new-vs-returning]', err.message);
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
