FROM node:18-alpine

# Install curl for health checks
RUN apk add --no-cache curl

WORKDIR /app

COPY package*.json ./

RUN npm install -g pnpm
RUN pnpm install

COPY . .

# Create necessary directories
RUN mkdir -p data/cookies data/tweets data/csv data/analysis uploads output

EXPOSE 3000

# Use tini for proper signal handling
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

CMD ["pnpm", "start"] 