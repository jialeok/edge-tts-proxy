const express = require('express');
const https = require('https');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const synthGoogle = (text) =>
  new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(text);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=zh-CN&q=${encoded}`;

    https.get(url, (resp) => {
      if (resp.statusCode >= 400) {
        return reject(new Error('HTTP ' + resp.statusCode));
      }
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });

app.post('/tts', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });

  try {
    const audio = await synthGoogle(text.trim());
    console.log('[TTS] Google TTS success, size:', audio.length);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audio.length
    });
    res.send(audio);
  } catch (err) {
    console.error('[TTS] Google TTS failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.send('Edge TTS Proxy OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TTS Proxy running on port ${PORT}`));
