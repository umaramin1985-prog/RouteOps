FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm install && npm cache clean --force && rm -rf /tmp/* /root/.npm

COPY . .
RUN rm -f update_guest*.py 2>/dev/null || true

# Build step omitted for development container; we'll run dev server
CMD ["npm", "run", "dev", "--", "--host"]
