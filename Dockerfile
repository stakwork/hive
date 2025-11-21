# Use the official Node.js 20 Alpine image as base
FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile --production=false

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

ENV ESLINT_NO_DEV_ERRORS=true
ENV STAKWORK_API_KEY=placeholder
ENV POOL_MANAGER_API_KEY=placeholder
ENV POOL_MANAGER_API_USERNAME=placeholder
ENV POOL_MANAGER_API_PASSWORD=placeholder
ENV SWARM_SUPERADMIN_API_KEY=placeholder
ENV SWARM_SUPER_ADMIN_URL=placeholder
ENV NEXT_PRIVATE_STANDALONE=true
# Build the application
RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static


USER nextjs

EXPOSE 3000

ENV PORT 3000
# set hostname to localhost
ENV HOSTNAME "0.0.0.0"

RUN chmod +x /app/server.js
RUN ls -la /app
RUN ls -la /app/server.js
#RUN ls -la /app/.next/standalone
RUN head -n 10 /app/server.js
# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD ["node", "./server.js"] 
