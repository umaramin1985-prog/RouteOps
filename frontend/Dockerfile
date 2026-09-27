FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm install

COPY . .

# Build step omitted for development container; we'll run dev server
CMD ["npm", "run", "dev", "--", "--host"]
