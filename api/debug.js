const axios = require('axios');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Debug endpoint - just return all query parameters
  res.status(200).json({
    method: req.method,
    url: req.url,
    query: req.query,
    params: {
      username: req.query.username,
      playerId: req.query.playerId,
      all: Object.keys(req.query)
    }
  });
};
