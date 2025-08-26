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

    // If we have a username, look up the player first
    if (username && !playerId) {
      console.log(`Fetching player info for username: ${username}`);
      
      // Try different search strategies for partial matches
      const searchQueries = [
        username, // Exact search first
        username.toLowerCase(), // Lowercase
        username.substring(0, Math.max(3, username.length - 2)), // Partial from start
        username.substring(0, Math.max(2, username.length - 3)) // Even shorter partial
      ];
      
      let allResults = [];
      const seenUsernames = new Set();
      
      // Try multiple search queries to find similar usernames
      for (const query of searchQueries) {
        try {
          const userResp = await axios.get(`https://online-go.com/api/v1/players?username=${encodeURIComponent(query)}`, {
            timeout: 10000,
            headers: {
              'User-Agent': 'PlanetGo-Stats-Fetcher/1.0'
            }
          });
          
          if (userResp.data.results && userResp.data.results.length > 0) {
            // Add unique results
            userResp.data.results.forEach(player => {
              if (!seenUsernames.has(player.username.toLowerCase())) {
                seenUsernames.add(player.username.toLowerCase());
                allResults.push(player);
              }
            });
          }
        } catch (err) {
          console.log(`Search query "${query}" failed, continuing...`);
          continue;
        }
        
        // If we have enough results, break early
        if (allResults.length >= 10) break;
      }
      
      // Also try a general search to get more players
      if (allResults.length < 10) {
        try {
          const generalResp = await axios.get(`https://online-go.com/api/v1/players?page_size=50`, {
            timeout: 10000,
            headers: {
              'User-Agent': 'PlanetGo-Stats-Fetcher/1.0'
            }
          });
          
          if (generalResp.data.results) {
            // Filter for usernames that contain parts of the search term
            const searchLower = username.toLowerCase();
            const filteredResults = generalResp.data.results.filter(player => {
              const playerNameLower = player.username.toLowerCase();
              return playerNameLower.includes(searchLower) || 
                     searchLower.includes(playerNameLower.substring(0, 3)) ||
                     levenshteinDistance(searchLower, playerNameLower) <= 3;
            });
            
            filteredResults.forEach(player => {
              if (!seenUsernames.has(player.username.toLowerCase()) && allResults.length < 15) {
                seenUsernames.add(player.username.toLowerCase());
                allResults.push(player);
              }
            });
          }
        } catch (err) {
          console.log('General search failed, using existing results');
        }
      }
      
      if (allResults.length === 0) {
        res.status(404).json({ error: 'No players found matching the search criteria' });
        return;
      }
      
      // Sort results by similarity to search term
      allResults.sort((a, b) => {
        const aSimilarity = calculateSimilarity(username.toLowerCase(), a.username.toLowerCase());
        const bSimilarity = calculateSimilarity(username.toLowerCase(), b.username.toLowerCase());
        return bSimilarity - aSimilarity;
      });
      
      // Limit to top 10 results
      allResults = allResults.slice(0, 10);
      
      // Check for exact match
      const exactMatch = allResults.find(p => 
        p.username.toLowerCase() === username.toLowerCase()
      );
      
      if (exactMatch) {
        userId = exactMatch.id;
        playerData = exactMatch;
      } else {
        // Return multiple players for frontend to handle selection
        res.json({
          multiple_players: true,
          players: allResults,
          search_term: username
        });
        return;
      }
    } else if (playerId) {
      // Get player info by ID
      console.log(`Fetching player info for ID: ${playerId}`);
      
      const playerResp = await axios.get(`https://online-go.com/api/v1/players/${playerId}/`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'PlanetGo-Stats-Fetcher/1.0'
        }
      });
      
      playerData = playerResp.data;
      userId = playerId;
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
    
    if (err.code === 'ECONNABORTED') {
      res.status(408).json({ error: 'Request timeout - OGS API is slow' });
    } else if (err.response) {
      console.error('OGS API response error:', err.response.status, err.response.data);
      res.status(err.response.status).json({ 
        error: `OGS API error: ${err.response.status}`,
        details: err.response.data 
      });
    } else {
      res.status(500).json({ error: 'Failed to fetch stats from OGS' });
    }
  }
};

// Helper function to calculate Levenshtein distance
function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

// Helper function to calculate similarity score
function calculateSimilarity(search, target) {
  const searchLower = search.toLowerCase();
  const targetLower = target.toLowerCase();
  
  // Exact match gets highest score
  if (searchLower === targetLower) return 100;
  
  // Check if target starts with search term
  if (targetLower.startsWith(searchLower)) return 90;
  
  // Check if target contains search term
  if (targetLower.includes(searchLower)) return 80;
  
  // Check if search term contains target (shorter target)
  if (searchLower.includes(targetLower)) return 70;
  
  // Calculate based on Levenshtein distance
  const distance = levenshteinDistance(searchLower, targetLower);
  const maxLength = Math.max(searchLower.length, targetLower.length);
  const similarity = ((maxLength - distance) / maxLength) * 60;
  
  return Math.max(0, similarity);
}
