const path = require("node:path");

const appCwd = process.env.LIVETRADER_CWD || path.resolve(__dirname, "..");

module.exports = {
  apps: [
    {
      name: process.env.LIVETRADER_PM2_NAME || "livetrader",
      cwd: appCwd,
      script: "npm",
      args: "run start",
      interpreter: "none",
      instances: 1,
      autorestart: true,
      watch: false,
      time: true,
      max_restarts: 100,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
