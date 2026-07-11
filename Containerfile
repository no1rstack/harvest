FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force
COPY dist/ ./dist/
COPY server.ts ./
COPY src/ ./src/
COPY scripts/osint-harvest/ ./scripts/osint-harvest/
COPY scripts/sync-infisical-db.sh ./scripts/
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
CMD ["node", "--import", "tsx", "server.ts"]
