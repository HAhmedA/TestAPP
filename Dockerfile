# Multi-stage build for React app (Create React App style)

# 1) Build stage
# Stage 1: Build static assets using Node
FROM node:18-alpine AS build
WORKDIR /app

# Install dependencies first to leverage Docker layer cache
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

# Copy source
COPY . .

# REACT_APP_* vars are baked at build-time in CRA
ARG REACT_APP_API_BASE
ENV REACT_APP_API_BASE=${REACT_APP_API_BASE}
ARG REACT_APP_ENABLE_MSW
ENV REACT_APP_ENABLE_MSW=${REACT_APP_ENABLE_MSW}

# Build production bundle
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


