import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream';
import { Readable } from 'stream';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});
app.use(express.static(path.join(__dirname, '../client')));

const keywords = JSON.parse(fs.readFileSync(path.join(__dirname, './data.json'), 'utf8'));

const allUrls = new Set();
for (const keyword in keywords) {
  keywords[keyword].forEach(url => allUrls.add(url));
}

app.post('/api/keywords', (req, res) => {
  console.log('req.body:', req.body);
  const { keyword } = req.body;
  if (!keyword) {
    return res.status(400).json({ error: 'Ключевое слово не указано' });
  }
  const urls = keywords[keyword];
  if (!urls) {
    return res.status(404).json({ error: 'URL не найдены для этого ключевого слова' });
  }
  res.json({ urls });
});

const streamPipeline = promisify(pipeline);

app.get('/api/download', async (req, res) => {
  const { url } = req.query;
  console.log(`Запрос на скачивание: ${url}`);
  if (!url || !allUrls.has(url)) {
    return res.status(400).json({ error: 'Недопустимый URL' });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      return res.status(500).json({ 
        error: 'Не удалось загрузить контент', 
        details: `Статус: ${response.status}`
      });
    }
    
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = response.headers.get('content-length');
    
    res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    
    const nodeReadable = Readable.fromWeb(response.body);
    await streamPipeline(nodeReadable, res);
    
  } catch (err) {
    console.error('Ошибка fetch:', err);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Время ожидания запроса истекло' });
    }
    return res.status(500).json({ 
      error: 'Ошибка загрузки', 
      details: err.message 
    });
  } finally {
    clearTimeout(timeoutId);
  }
});

app.get('/api/all-keywords', (req, res) => {
  res.json({ keywords: Object.keys(keywords) });
});

app.listen(PORT, () => console.log(`Сервер запущен на http://localhost:${PORT}`));