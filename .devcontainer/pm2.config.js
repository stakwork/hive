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
        PORT: "3000",
        INSTALL_COMMAND: "npm install",
        TEST_COMMAND: "npm run test",
        E2E_TEST_COMMAND: "npx playwright test",
        BUILD_COMMAND: "npm run build",
        PRE_START_COMMAND: "npx prisma migrate dev",
        RESET_COMMAND: "npx -y prisma migrate reset -f"
      }
    }
  ],
};
