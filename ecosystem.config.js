module.exports = {
  apps: [
    {
      name: 'api-tct-crm',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',           // dùng fork thay vì cluster (tốt hơn trên Windows)
      autorestart: true,          // tự restart nếu crash
      watch: false,               // không watch file (production)
      max_memory_restart: '300M', // restart nếu dùng quá 300MB RAM
      env: {
        NODE_ENV: 'production',
      },
      // Ghi log ra file
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
