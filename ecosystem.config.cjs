/**
 * PM2 ecosystem config for Automatic Asset Detection.
 *
 * Usage:
 *   npm install -g pm2          # install PM2 globally (once)
 *   pm2 start ecosystem.config.cjs   # start worker
 *   pm2 save                    # persist across reboots
 *   pm2 startup                 # generate startup script
 *   pm2 logs detection-worker   # tail logs
 *   pm2 monit                   # live dashboard
 *
 * Worker auto-restarts on crash. Next.js app is NOT managed here —
 * run `npm run start` or use a separate process manager for the web server.
 */

module.exports = {
  apps: [
    {
      name: 'detection-worker',
      script: 'workers/detection-worker.ts',
      interpreter: 'ts-node',
      interpreter_args: '--project tsconfig.worker.json -r tsconfig-paths/register',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 3000,   // wait 3s before restart on crash
      max_restarts: 10,      // stop restarting after 10 consecutive crashes
      min_uptime: '10s',     // consider stable if running >10s

      env: {
        NODE_ENV: 'production',
      },

      // Structured logging — JSON lines go to PM2 log files
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/worker-error.log',
      out_file: 'logs/worker-out.log',
      merge_logs: true,
    },
  ],
};
