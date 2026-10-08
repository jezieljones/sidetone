FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/sidetone/package.json apps/sidetone/package.json
COPY packages/sidetone-contracts packages/sidetone-contracts
COPY workers/sidetone-realtime workers/sidetone-realtime
COPY workers/sidetone-discord/package.json workers/sidetone-discord/package.json
COPY workers/sidetone-zoom-rtms/package.json workers/sidetone-zoom-rtms/package.json
RUN npm ci --ignore-scripts && npm run build --workspace @sidetone/realtime
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["npm", "run", "start", "--workspace", "@sidetone/realtime"]
