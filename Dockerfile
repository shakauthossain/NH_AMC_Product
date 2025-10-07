# 1️⃣ Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package.json and lock file first (better caching)
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the project files
COPY . .

# Build the Vite app
RUN npm run build

# 2️⃣ Serve with Nginx
FROM nginx:stable-alpine

# Clean default nginx html folder
RUN rm -rf /usr/share/nginx/html/*

# Copy dist from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# (Optional) custom nginx.conf for SPA routing
# COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 81

CMD ["nginx", "-g", "daemon off;"]
