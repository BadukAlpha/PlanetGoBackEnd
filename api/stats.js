const axios = require('axios');

module.exports = async (req, res) => {
  // Enable CORS for your specific domains
  const allowedOrigins = [
    'https://planetgo-flame.vercel.app',
    'https://badukalpha.github.io',
    'http://localhost:3000',
    'http://127.0.0.1:5500'
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { username } = req.query;
  if (!username) {
    res.status(400).json({ error: 'Username parameter is required' });
    return;
  }

  try {
    console.log(`Fetching stats for username: ${username}`);
    
    // First, get user info
    const userResp = await axios.get(`https://online-go.com/api/v1/players?username=${encodeURIComponent(username)}`, {
      timeout: 10000,
      headers: {
        'User-Agent': 'PlanetGo-Stats-Fetcher/1.0'
      }
    });
    
    if (!userResp.data.results || userResp.data.results.length === 0) {
      res.status(404).json({ error: 'User not found on OGS' });
      return;
    }
    
    const userId = userResp.data.results[0].id;
    console.log(`Found user ID: ${userId}`);
    
    // Then get their games
    const gamesResp = await axios.get(`https://online-go.com/api/v1/players/${userId}/games/`, {
      timeout: 15000,
      headers: {
        'User-Agent': 'PlanetGo-Stats-Fetcher/1.0'
      }
    });
    
    console.log(`Successfully fetched ${gamesResp.data.results?.length || 0} games`);
    res.json(gamesResp.data);
    
  } catch (err) {
    console.error('Error fetching stats:', err.message);
    
    if (err.code === 'ECONNABORTED') {
      res.status(408).json({ error: 'Request timeout - OGS API is slow' });
    } else if (err.response) {
      res.status(err.response.status).json({ 
        error: `OGS API error: ${err.response.status}` 
      });
    } else {
      res.status(500).json({ error: 'Failed to fetch stats from OGS' });
    }
  }
};
