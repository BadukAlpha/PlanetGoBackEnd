const axios = require('axios');

module.exports = async (req, res) => {
  // Fixed CORS headers for Vercel deployment
  // --- CORS HEADERS ---
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

  // Handle preflight OPTIONS request immediately
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { username, playerId, pageSize, maxGames, ordering } = req.query;
  
  // Must have either username or playerId
  if (!username && !playerId) {
    res.status(400).json({ error: 'Username or playerId parameter is required' });
    return;
  }

  try {
    let userId = playerId;
    let playerData = null;

    // If we have a username, look up the player first (exact match only)
    if (username && !playerId) {
      console.log(`Fetching player info for exact username: ${username}`);
      
      const userResp = await axios.get(`https://online-go.com/api/v1/players?username=${encodeURIComponent(username)}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'PlanetGo-Stats-Fetcher/1.0'
        }
      });
      
      if (!userResp.data.results || userResp.data.results.length === 0) {
        res.status(404).json({ error: 'No player found with that exact username' });
        return;
      }
      
      // Find exact match only (case-insensitive)
      const exactMatch = userResp.data.results.find(p => 
        p.username.toLowerCase() === username.toLowerCase()
      );
      
      if (exactMatch) {
        userId = exactMatch.id;
        playerData = exactMatch;
        console.log(`Found exact match: ${exactMatch.username} (ID: ${exactMatch.id})`);
      } else {
        res.status(404).json({ error: 'No exact username match found' });
        return;
      }
    } else if (playerId) {
      // Get player info by ID
      console.log(`Fetching player info for ID: ${playerId}`);
      
      try {
        const playerResp = await axios.get(`https://online-go.com/api/v1/players/${playerId}/`, {
          timeout: 10000,
          headers: {
            'User-Agent': 'PlanetGo-Stats-Fetcher/1.0'
          }
        });
        
        playerData = playerResp.data;
        userId = playerId;
        console.log(`Found player: ${playerData.username} (ID: ${userId})`);
      } catch (err) {
        if (err.response && err.response.status === 404) {
          res.status(404).json({ error: 'Player not found with that ID' });
          return;
        }
        throw err; // Re-throw other errors to be handled by main catch
      }
    }

    console.log(`Found user ID: ${userId}`);
    
    // Build games API URL with parameters
    const gamesParams = new URLSearchParams();
    
    // Set page size (default 20, max 100 to prevent abuse)
    const pageSizeNum = Math.min(parseInt(pageSize) || 20, 100);
    gamesParams.append('page_size', pageSizeNum.toString());
    
    // Set ordering (default to most recent first)
    const orderBy = ordering || '-ended';
    gamesParams.append('ordering', orderBy);
    
    const gamesUrl = `https://online-go.com/api/v1/players/${userId}/games/?${gamesParams.toString()}`;
    console.log(`Fetching games from: ${gamesUrl}`);
    
    // Fetch games
    const gamesResp = await axios.get(gamesUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': 'PlanetGo-Stats-Fetcher/1.0'
      }
    });
    
    const gamesData = gamesResp.data;
    
    // If maxGames is specified and less than what we got, limit the results
    if (maxGames) {
      const maxGamesNum = parseInt(maxGames);
      if (maxGamesNum > 0 && gamesData.results && gamesData.results.length > maxGamesNum) {
        gamesData.results = gamesData.results.slice(0, maxGamesNum);
        gamesData.count = Math.min(gamesData.count || 0, maxGamesNum);
      }
    }
    
    console.log(`Successfully fetched ${gamesData.results?.length || 0} games`);
    
    // Return combined player and games data
    res.json({
      player: playerData,
      games: gamesData,
      success: true
    });
    
  } catch (err) {
    console.error('Error fetching stats:', err.message);
    console.error('Error details:', err.response?.data || 'No response data');
    
    if (err.code === 'ECONNABORTED') {
      res.status(408).json({ error: 'Request timeout - OGS API is slow' });
    } else if (err.response) {
      console.error('OGS API response error:', err.response.status, err.response.data);
      
      // Handle specific OGS API errors
      if (err.response.status === 404) {
        res.status(404).json({ 
          error: playerId ? 'Player not found with that ID' : 'Username not found on OGS'
        });
      } else {
        res.status(err.response.status).json({ 
          error: `OGS API error: ${err.response.status}`,
          details: err.response.data 
        });
      }
    } else {
      res.status(500).json({ error: 'Failed to fetch stats from OGS' });
    }
  }
};
