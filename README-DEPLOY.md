# Hướng dẫn Deploy API TCT_CRM lên Production Server

## Yêu cầu hệ thống

- **Node.js** >= 18.x ([tải tại nodejs.org](https://nodejs.org))
- **SQL Server** đang chạy và có database `TCT_CRM`
- **PM2** (process manager, cài sau)

---

## Các bước triển khai

### 1. Copy code lên server

Copy toàn bộ folder lên server (trừ `node_modules` và `.env`).

Nếu dùng file nén, giải nén vào thư mục mong muốn, ví dụ:
```
C:\Apps\API_TCT_CRM\
```

### 2. Cài đặt dependencies

Mở PowerShell/CMD tại thư mục project, chạy:

```bash
npm install --omit=dev
```

> `--omit=dev` sẽ bỏ qua các package dev (nodemon...) không cần thiết khi production.

### 3. Cấu hình biến môi trường

Tạo file `.env` từ template:

```bash
copy .env.example .env
```

Sau đó mở `.env` và điền các giá trị thực tế:

```env
PORT=3005
DB_SERVER=localhost          # hoặc tên server SQL
DB_USER=sa
DB_PASSWORD=your_password
DB_NAME=TCT_CRM
API_KEY=your_strong_api_key  # PHẢI đổi thành key bảo mật
```

### 4. Kiểm tra kết nối Database

```bash
node test-connection.js
```

### 5. Chạy API bằng PM2 (khuyến nghị)

Cài PM2 nếu chưa có:
```bash
npm install -g pm2
```

Khởi động API:
```bash
pm2 start server.js --name "api-tct-crm"
```

Tự động chạy khi server khởi động lại:
```bash
pm2 startup
pm2 save
```

Các lệnh PM2 hữu ích:
```bash
pm2 status              # xem trạng thái
pm2 logs api-tct-crm    # xem log
pm2 restart api-tct-crm # khởi động lại
pm2 stop api-tct-crm    # dừng
```

---

## Kiểm tra API đang chạy

Truy cập trình duyệt hoặc dùng curl:

```
http://localhost:3005/api-docs   → Swagger UI
http://localhost:3005/health     → Health check (nếu có)
```

---

## Lưu ý bảo mật khi Production

- ✅ Đổi `API_KEY` thành chuỗi ngẫu nhiên dài (>= 32 ký tự)
- ✅ Không commit file `.env` lên Git
- ✅ Giới hạn IP được phép truy cập nếu là API nội bộ
- ✅ Dùng HTTPS nếu expose ra internet (kết hợp Nginx + SSL)
