module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    // Vercel passes the original URL in x-vercel-proxied-for or we parse req.url
    // req.url here will be /api/gamma?vercel rewrite appends original as ?path or similar
    // Use req.headers['x-vercel-rewrite-chain'] or just grab from query
    const originalUrl = req.headers['x-vercel-forwarded-host']
      ? req.url
      : req.url;

    // Strip /api/gamma prefix
    const stripped = req.url.replace(/^\/api\/gamma/, '').replace(/^\/gamma/, '') || '/';
    const url = `https://gamma-api.polymarket.com${stripped}`;
    console.log('req.url:', req.url, '→', url);

    const upstream = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json');
    res.status(upstream.status).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message, url: req.url });
  }
};