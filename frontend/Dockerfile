# Build the SPA, then serve it with nginx.

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Empty on purpose: the app is served from the same origin as the API, and nginx
# proxies /api and /images through to the backend. See API_BASE in src/lib/api.ts.
ENV VITE_API_URL=""
RUN npm run build


FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
