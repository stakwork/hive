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
        INSTALL_COMMAND: "npm i && npx prisma migrate dev",
        TEST_COMMAND: "",
        BUILD_COMMAND: "",
        PORT: "3457"
      }
    }
  ],
};
