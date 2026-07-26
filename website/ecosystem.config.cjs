const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "passwisely-web",
      cwd: __dirname,
      script: "/home/jerry/.local/bin/pnpm",
      args: [
        "exec",
        "wrangler",
        "dev",
        "--config",
        "dist/server/wrangler.json",
        "--ip",
        "127.0.0.1",
        "--port",
        "3011",
        "--persist-to",
        path.join(__dirname, ".wise-data"),
        "--local",
      ],
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
        PATH:
          "/home/jerry/.nvm/versions/node/v22.15.0/bin:/home/jerry/.local/bin:/usr/local/bin:/usr/bin:/bin",
      },
    },
  ],
};
