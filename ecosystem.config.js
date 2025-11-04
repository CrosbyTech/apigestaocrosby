module.exports = {
  apps: [
    {
      name: 'api-gestao-crosby',
      script: 'index.js',
      instances: 1, // Garantir 1 instância para controlar conexões
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      env: {
        NODE_ENV: 'development',
        PORT: 4000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      // Configurações de monitoramento
      monitoring: true,
      pmx: true,
      // Restart automático em caso de falha
      min_uptime: '10s',
      max_restarts: 10,
      // Configurações de log
      log_date_format: 'YYYY-MM-DD HH:mm Z',
      // Merge logs
      merge_logs: true,
      // Kill timeout
      kill_timeout: 1600
    }
  ],

  // Configurações de deploy (opcional)
  deploy: {
    production: {
      user: 'node',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:your-repo.git',
      path: '/var/www/api-gestao-crosby',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.refatorado.config.js --env production',
      'pre-setup': ''
    }
  }
};