# 📘 Hướng dẫn sử dụng TCT_CRM API

> API nội bộ — chỉ truy cập được trong mạng LAN công ty

---

## 🔗 Địa chỉ truy cập

| Mục đích | URL |
|---|---|
| 📖 Xem tài liệu API (Swagger) | http://192.168.0.239:3005/api-docs |
| ❤️ Kiểm tra trạng thái | http://192.168.0.239:3005/health |
| 📦 Import vào Postman | http://192.168.0.239:3005/api-docs.json |

---

## 🔑 API Key

Mọi request đến `/api/*` đều cần header:

```
x-api-key: tct_crm_sk_2024_XyZ9mN3pQ7rS
```

---

## 📋 Danh sách Endpoints chính

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/customers` | Danh sách khách hàng |
| GET | `/api/orders` | Danh sách đơn hàng |
| GET | `/api/leads` | Danh sách leads |
| GET | `/api/products` | Danh sách sản phẩm |
| GET | `/api/reports/revenue` | Báo cáo doanh thu |
| GET | `/api/reports/leads-funnel` | Phễu leads |

---

## 🚀 Cách dùng nhanh với Swagger UI

1. Vào **http://192.168.0.239:3005/api-docs**
2. Nhấn nút **Authorize** 🔒 (góc trên bên phải)
3. Nhập API Key vào ô `ApiKeyAuth` → **Authorize** → **Close**
4. Chọn endpoint muốn thử → **Try it out** → điền tham số → **Execute**

---

## 🔧 Dùng với Postman

1. Mở Postman → **Import**
2. Chọn tab **Link**
3. Dán: `http://192.168.0.239:3005/api-docs.json`
4. Postman tự tạo collection đầy đủ
5. Vào **Collection** → **Variables** → thêm biến `api_key` = `tct_crm_sk_2024_XyZ9mN3pQ7rS`

---

## 🔍 Ví dụ gọi API bằng curl

```bash
# Lấy danh sách leads
curl -H "x-api-key: tct_crm_sk_2024_XyZ9mN3pQ7rS" http://192.168.0.239:3005/api/leads

# Lấy leads có phân trang
curl -H "x-api-key: tct_crm_sk_2024_XyZ9mN3pQ7rS" "http://192.168.0.239:3005/api/leads?page=1&limit=20"

# Lấy chi tiết lead ID=5
curl -H "x-api-key: tct_crm_sk_2024_XyZ9mN3pQ7rS" http://192.168.0.239:3005/api/leads/5
```

---

*Liên hệ IT nếu cần hỗ trợ thêm.*
