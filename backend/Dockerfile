# Simple Node image to run the Express backend
FROM node:18-alpine
WORKDIR /app

# Install only runtime dependencies
COPY package.json ./
RUN npm install --only=production --no-audit --no-fund

# Copy application source
COPY server.js ./

ENV PORT=8080
EXPOSE 8080
# Start the app via package.json script
CMD ["npm", "start"]

