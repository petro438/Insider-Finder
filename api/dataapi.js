module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const stripped = req.url.replace(/^\/api\/dataapi/, '').replace(/^\/dataapi/, '') || '/';
    const url = `https://data-api.polymarket.com${stripped}`;
    console.log('req.url:', req.url, '→', url);

    const upstream = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json');
    res.status(upstream.status).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message, url: req.url });
  }
};