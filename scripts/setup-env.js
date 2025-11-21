#!/usr/bin/env node

const crypto = require("crypto");

console.log("🔐 Generating secure JWT secret...\n");

// Generate a secure random string for JWT secret
const jwtSecret = crypto.randomBytes(64).toString("hex");

console.log("✅ Generated JWT_SECRET:");
console.log(`JWT_SECRET="${jwtSecret}"\n`);

console.log("📝 Add this to your .env file:");
console.log("=====================================");
console.log(`JWT_SECRET="${jwtSecret}"`);
console.log("=====================================\n");

console.log("⚠️  Important Security Notes:");
console.log("- Keep this secret secure and never commit it to version control");
console.log("- Use different secrets for development, staging, and production");
console.log("- Rotate the secret periodically in production");
console.log("- Store production secrets in a secure environment variable service\n");

console.log("🚀 You can now run: npm run dev");
