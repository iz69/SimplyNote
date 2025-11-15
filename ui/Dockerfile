FROM node:20

WORKDIR /ui

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM nginx:stable-alpine

COPY --from=build /ui/dist /usr/share/nginx/html

## COPY nginx.conf /etc/nginx/conf.d/default.conf
