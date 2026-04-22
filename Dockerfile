FROM node:20-alpine

RUN apk add --no-cache bash

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

ENV NODE_ENV=stage
ENV DOCKER_CONTAINER=true
ENV PORT=3000

EXPOSE 3000

CMD ["sh", "-c", "npx sequelize-cli db:migrate && node ./bin/www"]
