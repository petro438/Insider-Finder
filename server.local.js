import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.static(__dirname));

app.use('/gamma', createProxyMiddleware({
  target: 'https://gamma-api.polymarket.com',
  changeOrigin: true,
  pathRewrite: { '^/gamma': '' },
}));

app.use('/dataapi', createProxyMiddleware({
  target: 'https://data-api.polymarket.com',
  changeOrigin: true,
  pathRewrite: { '^/dataapi': '' },
}));

app.listen(3000, () => console.log('🚀 http://localhost:3000'));