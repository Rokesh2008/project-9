FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/prisma apps/api/prisma
RUN npm ci
COPY apps/web/src apps/web/src
COPY apps/web/public apps/web/public
COPY apps/web/index.html apps/web/tsconfig.json apps/web/
ARG VITE_API_URL=http://localhost:3000/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build -w apps/web
FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:15c994d10d6d78658721c3bcafff14cb281fba2a4bdf9d5ba92c416a472516e3
COPY apps/web/nginx.dev.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
