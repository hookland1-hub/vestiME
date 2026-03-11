// VestiME — Gemini Proxy
// La API key non è mai esposta al client.
// Vercel la legge dalle Environment Variables.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

// Rate limiting in-memory (per IP, si resetta ad ogni cold start)
// Per un rate limit persistente usare Vercel KV o Redis
const rateMap = {};
const RATE_LIMIT = 10;      // max richieste per IP
const RATE_WINDOW = 60000;  // finestra in ms (1 minuto)

function checkRateLimit(ip) {
  const now = Date.now();
  if (!rateMap[ip]) rateMap[ip] = { count: 0, start: now };
  const entry = rateMap[ip];
  if (now - entry.start > RATE_WINDOW) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

export default async function handler(req, res) {
  // CORS — accetta solo dallo stesso dominio Vercel
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: { message: 'Troppe richieste. Attendi un minuto e riprova.' } });
  }

  // API key dalla env var — MAI esposta al client
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    return res.status(500).json({ error: { message: 'Server non configurato correttamente.' } });
  }

  try {
    const { model, body } = req.body;

    if (!model || !body) {
      return res.status(400).json({ error: { message: 'Richiesta malformata.' } });
    }

    // Valida il model name (whitelist)
    const ALLOWED_MODELS = [
      'gemini-3-flash-preview',
      'gemini-3.1-flash-image-preview',
      'gemini-2.0-flash-exp',
      'gemini-2.0-flash-preview-image-generation',
    ];
    if (!ALLOWED_MODELS.includes(model)) {
      return res.status(400).json({ error: { message: 'Modello non supportato.' } });
    }

    const endpoint = GEMINI_BASE + model + ':generateContent';

    const geminiResp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_KEY,
      },
      body: JSON.stringify(body),
    });

    const data = await geminiResp.json();

    // Restituisci la risposta con lo stesso status code di Gemini
    return res.status(geminiResp.status).json(data);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: { message: 'Errore interno del proxy.' } });
  }
}
