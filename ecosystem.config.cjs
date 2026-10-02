/**
 * PM2 ecosystem config for Automatic Asset Detection.
 *
 * Usage:
 *   npx pm2 start ecosystem.config.cjs   # start worker
 *   npx pm2 save                         # persist across reboots
 *   npx pm2 logs detection-worker        # tail logs
 *   npx pm2 stop detection-worker        # stop
 *   npx pm2 restart detection-worker     # restart
 */

module.exports = {
  apps: [
    {
      name: 'detection-worker',
      script: 'node_modules/.bin/tsx',
      args: '--env-file=.env.local workers/detection-worker.ts',
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',

      env: {
        NODE_ENV: 'production',
      },

      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/worker-error.log',
      out_file: 'logs/worker-out.log',
      merge_logs: true,
    },
  ],
};
