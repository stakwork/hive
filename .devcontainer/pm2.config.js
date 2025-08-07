module.exports = {
  apps: [
    {
      name: "frontend",
      script: "npm run dev",
      cwd: "/workspaces/tom-test-hive.sphinx.chat",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        PORT: "3000",
        INSTALL_COMMAND: "npm install",
        TEST_COMMAND: "vitest run",
        BUILD_COMMAND: "next build",
        PRE_START_COMMAND: "npx prisma migrate dev​"
      }
    }
  ],
};
