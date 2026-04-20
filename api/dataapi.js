export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const incoming = req.url;
    const stripped = incoming.replace(/^\/api\/dataapi/, '') || '/';
    const url = `https://data-api.polymarket.com${stripped}`;

    const upstream = await fetch(url, {
      method: req.method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    });

    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json');
    res.status(upstream.status).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}