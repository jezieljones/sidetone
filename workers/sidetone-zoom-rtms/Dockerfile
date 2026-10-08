FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/sidetone/package.json apps/sidetone/package.json
COPY packages/sidetone-contracts packages/sidetone-contracts
COPY workers workers
RUN npm ci && npm run build --workspace @sidetone/zoom-rtms
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "start", "--workspace", "@sidetone/zoom-rtms"]
