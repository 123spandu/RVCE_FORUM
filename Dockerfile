# RVCE Connect — production image
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Uploads directory for multer
RUN mkdir -p uploads

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Wait for MySQL then start (simple retry loop)
CMD ["sh", "-c", "node -e \"const m=require('mysql2/promise');(async()=>{for(let i=0;i<30;i++){try{const c=await m.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD});await c.end();process.exit(0)}catch(e){console.log('Waiting for MySQL...',e.message);await new Promise(r=>setTimeout(r,2000))}}process.exit(1)})()\" && node server.js"]
