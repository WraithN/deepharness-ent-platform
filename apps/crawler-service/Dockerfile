# crawler-service
# Playwright + Firecrawl 网站抓取服务

FROM mcr.microsoft.com/playwright:v1.45.3-jammy

WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm@9.15.5

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

ENV PORT=8091
ENV BROWSER_HEADLESS=true

EXPOSE 8091

CMD ["node", "dist/index.js"]
