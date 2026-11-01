FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile

# Publishable browser key only. Never pass Clerk secrets, DATABASE_URL or R2 keys as build args.
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_CLERK_PROXY_URL=""
RUN test -n "$VITE_CLERK_PUBLISHABLE_KEY"
ENV NODE_ENV=production PORT=10000 BASE_PATH=/
RUN pnpm --filter @workspace/cut-render build && pnpm --filter @workspace/api-server build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=10000 STATIC_DIR=/app/artifacts/cut-render/dist/public
# Keep pnpm's dependency layout for external modules used by the API bundle.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules
COPY --from=build --chown=node:node /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=build --chown=node:node /app/artifacts/cut-render/dist/public ./artifacts/cut-render/dist/public
USER node
EXPOSE 10000
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
