FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY src ./src
COPY .env.example ./.env.example
RUN mkdir -p uploads
EXPOSE 8080
CMD ["npm","run","start"]
