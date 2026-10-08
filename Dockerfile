FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/sidetone/package.json apps/sidetone/package.json
COPY packages/sidetone-contracts/package.json packages/sidetone-contracts/package.json
COPY workers/sidetone-realtime/package.json workers/sidetone-realtime/package.json
COPY workers/sidetone-discord/package.json workers/sidetone-discord/package.json
COPY workers/sidetone-zoom-rtms/package.json workers/sidetone-zoom-rtms/package.json
RUN npm ci --ignore-scripts
COPY apps/sidetone apps/sidetone
COPY packages/sidetone-contracts packages/sidetone-contracts
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CONVEX_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace @sidetone/web
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/sidetone/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/sidetone/.next/static ./apps/sidetone/.next/static
COPY --from=build --chown=node:node /app/apps/sidetone/public ./apps/sidetone/public
USER node
EXPOSE 3000
CMD ["node", "apps/sidetone/server.js"]
