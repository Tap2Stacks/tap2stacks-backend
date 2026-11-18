FROM node:24-alpine AS builder

WORKDIR /usr/src/app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false

COPY . .
RUN yarn build

FROM node:24-alpine AS runner

ENV NODE_ENV=production

WORKDIR /usr/src/app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=true && yarn cache clean

COPY --from=builder /usr/src/app/dist ./dist

EXPOSE 5001

CMD ["sh", "-c", "node ./node_modules/typeorm/cli.js migration:run -d dist/libs/typeorm.config.js && exec node dist/main.js"]
