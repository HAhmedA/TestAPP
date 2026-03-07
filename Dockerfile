# Multi-stage build for React app (Create React App style)

# 1) Build stage
# Stage 1: Build static assets using Node
FROM node:18-alpine AS build
WORKDIR /app

# Install dependencies first to leverage Docker layer cache
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --legacy-peer-deps

# Copy source
COPY . .

# VITE_* vars are baked at build-time by Vite
ARG VITE_API_BASE
ENV VITE_API_BASE=${VITE_API_BASE}

# Build production bundle — disable source maps + cap heap for 1 GB RAM hosts (e.g. t2.micro)
# GENERATE_SOURCEMAP=false cuts peak webpack memory by ~50% (no .map files generated)
ENV NODE_OPTIONS=--max_old_space_size=700
ENV GENERATE_SOURCEMAP=false
RUN npm run build

# Stage 2: Runtime - serve static files via nginx
FROM nginx:1.27-alpine AS runtime

# Copy build output to nginx html directory
COPY --from=build /app/build /usr/share/nginx/html
# Replace default server with SPA-friendly config (fallback to index.html for client routing)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Optional: include robots.txt for crawlers
COPY public/robots.txt /usr/share/nginx/html/robots.txt

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]


