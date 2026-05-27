const express = require('express');
const WebSocket = require('ws');
const crypto = require('crypto');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const WS_URLS = [
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491C6F4',
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491C6F4&ConnectionId='
];

const buildSSML = (text, voice, rate, pitch) =>
  `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="zh-CN">` +
  `<voice name="${voice}">` +
  `<prosody rate="${rate}%" pitch="${pitch}%">` +
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') +
  `</prosody></voice></speak>`;

const synthOne = (wsUrl, text, voice = 'zh-CN-XiaoxiaoNeural', rate = 0, pitch = 0) =>
  new Promise((resolve, reject) => {
    console.log('[TTS] Connecting to:', wsUrl.substring(0, 80) + '...');
    const ws = new WebSocket(wsUrl, {
      headers: {
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache'
      }
    });

    const chunks = [];
    let resolved = false;

    ws.on('open', () => {
      console.log('[TTS] WebSocket opened, sending config + SSML');
      const configMsg =
        `X-Timestamp:${new Date().toISOString()}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":false},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`;

      const ssml = buildSSML(text, voice, rate, pitch);
      const ssmlMsg =
        `X-RequestId:${crypto.randomUUID()}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;

      ws.send(configMsg);
      ws.send(ssmlMsg);
    });

    ws.on('message', (data) => {
      if (data instanceof Buffer) {
        chunks.push(data);
      } else {
        const str = data.toString();
        console.log('[TTS] text message:', str.substring(0, 200));
        if (str.includes('Path:turn.end')) {
          resolved = true;
          ws.close();
          resolve(Buffer.concat(chunks));
        }
      }
    });

    ws.on('error', (err) => {
      console.error('[TTS] WebSocket error:', err.message);
      if (!resolved) { resolved = true; reject(err); }
    });

    ws.on('close', (code, reason) => {
      console.log('[TTS] WebSocket closed, code=' + code + ' reason=' + reason.toString().substring(0, 100));
      if (!resolved) {
        resolved = true;
        if (chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error('WS closed code=' + code + ' - No audio received'));
        }
      }
    });

    ws.on('unexpected-response', (req, res) => {
      console.error('[TTS] Unexpected response:', res.statusCode, res.statusMessage);
      if (!resolved) { resolved = true; reject(new Error('HTTP ' + res.statusCode + ' ' + res.statusMessage)); }
    });

    setTimeout(() => {
      if (!resolved) { resolved = true; ws.close(); reject(new Error('TTS timeout 30s')); }
    }, 30000);
  });

app.post('/tts', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });

  let lastErr = null;
  for (const wsUrl of WS_URLS) {
    try {
      console.log('[TTS] Trying endpoint...');
      const audio = await synthOne(wsUrl, text.trim());
      console.log('[TTS] Success, audio size:', audio.length);
      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': audio.length
      });
      return res.send(audio);
    } catch (err) {
      console.error('[TTS] Failed with endpoint:', err.message);
      lastErr = err;
    }
  }

  res.status(500).json({ error: lastErr ? lastErr.message : 'All endpoints failed' });
});

app.get('/', (req, res) => res.send('Edge TTS Proxy OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Edge TTS Proxy running on port ${PORT}`));