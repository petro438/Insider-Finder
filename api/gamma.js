module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    // req.url will be something like /api/gamma/markets?slug=foo
    // Strip the /api/gamma prefix to get /markets?slug=foo
    const stripped = req.url.replace(/^\/api\/gamma/, '') || '/';
    const url = `https://gamma-api.polymarket.com${stripped}`;
    console.log('Gamma proxying to:', url);

    const upstream = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json');
    res.status(upstream.status).send(text);
  } catch (err) {
    console.error('Gamma error:', err.message);
    res.status(500).json({ error: err.message });
  }
};