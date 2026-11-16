module.exports = {
  apps: [
    {
      name: "nexus-quant",
      script: "./node_modules/tsx/dist/cli.mjs",
      args: "src/index.ts",
      cwd: "C:/Users/gamer/Projects/nexus-quant-suite",
      instances: 1,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 2000,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        DATA_SOURCE: "SIMULATED",
        PORT: "8080"
      },
      error_file: "logs/nexus_error.log",
      out_file: "logs/nexus_out.log",
      merge_logs: true,
      time: true
    }
  ]
};
