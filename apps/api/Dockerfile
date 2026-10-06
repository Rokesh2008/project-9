FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/prisma apps/api/prisma
RUN npm ci
COPY apps/api apps/api
RUN npm run build -w apps/api
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/prisma ./prisma
ENV NODE_PATH=/app/apps/api/node_modules:/app/node_modules
ENV PATH=/app/apps/api/node_modules/.bin:/app/node_modules/.bin:$PATH
EXPOSE 3000
CMD ["sh", "-c", "prisma migrate deploy --schema prisma/schema.prisma && node dist/main.js"]
