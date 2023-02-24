FROM node

WORKDIR /app

COPY . .

RUN npm i

EXPOSE 3002

CMD ["npm", "run", "dev"]