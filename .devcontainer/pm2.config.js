module.exports = {
  apps: [
    {
      name: "frontend",
      script: "npm run dev",
      cwd: "/workspaces/hive",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        INSTALL_COMMAND: "npm install",
        TEST_COMMAND: "vitest run",
        BUILD_COMMAND: "next build",
        PORT: "3000"
      }
    }
  ],
};
