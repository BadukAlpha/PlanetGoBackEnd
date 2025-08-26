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

  // Extract parameters
  const username = req.query.username;
  const playerId = req.query.playerId;
  const pageSize = req.query.pageSize;
  const maxGames = req.query.maxGames;
  const ordering = req.query.ordering;
  
  // Debug logging
  console.log('Raw query object:', req.query);
  console.log('Received parameters:', { username, playerId, pageSize, maxGames, ordering });
  console.log('typeof playerId:', typeof playerId);
  console.log('playerId value:', playerId);
  console.log('!!playerId:', !!playerId);
  
  // Must have either username or playerId
  if (!username && !playerId) {
    console.log('Error: No username or playerId provided');
    console.log('username:', username, 'playerId:', playerId);
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
    
    // Parse pagination parameters with safeguards
    const requestedMaxGames = Math.min(parseInt(maxGames) || 20, 10000); // Cap at 10,000 games
    const requestedPageSize = parseInt(pageSize) || Math.min(requestedMaxGames, 100);
    const orderBy = ordering || '-ended';
    
    console.log(`Requested maxGames: ${requestedMaxGames}, pageSize: ${requestedPageSize}`);
    
    // Add timeout protection for large requests
    const startTime = Date.now();
    const maxExecutionTime = 25000; // 25 seconds (Vercel has 30s limit)
    
    // Fetch games with pagination support
    let allGames = [];
    let page = 1;
    let hasMore = true;
    let totalFetched = 0;
    const maxPages = Math.ceil(requestedMaxGames / 100); // Theoretical max pages needed
    
    console.log(`Starting pagination fetch, max pages: ${maxPages}`);
    
    while (hasMore && totalFetched < requestedMaxGames && page <= maxPages) {
      // Check if we're approaching timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > maxExecutionTime) {
        console.log(`Timeout protection: stopping after ${elapsed}ms, fetched ${totalFetched} games`);
        break;
      }
      
      const gamesParams = new URLSearchParams();
      
      // Calculate page size for this request
      const remainingGames = requestedMaxGames - totalFetched;
      const currentPageSize = Math.min(remainingGames, 100); // OGS API limit is 100 per request
      
      gamesParams.append('page_size', currentPageSize.toString());
      gamesParams.append('page', page.toString());
      gamesParams.append('ordering', orderBy);
      
      const gamesUrl = `https://online-go.com/api/v1/players/${userId}/games/?${gamesParams.toString()}`;
      console.log(`Fetching page ${page}/${maxPages} (${currentPageSize} games)`);
      
      try {
        const gamesResp = await axios.get(gamesUrl, {
          timeout: 8000, // Shorter timeout per request
          headers: {
            'User-Agent': 'PlanetGo-Stats-Fetcher/1.0'
          }
        });
        
        const gamesData = gamesResp.data;
        
        if (gamesData.results && gamesData.results.length > 0) {
          allGames = allGames.concat(gamesData.results);
          totalFetched += gamesData.results.length;
          
          console.log(`Page ${page}: +${gamesData.results.length} games (total: ${totalFetched}/${requestedMaxGames})`);
          
          // Check if there are more pages
          hasMore = gamesData.next !== null && totalFetched < requestedMaxGames;
          page++;
          
          // Add a small delay between requests to be respectful to OGS API
          if (hasMore && page <= maxPages) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        } else {
          console.log(`Page ${page}: No more games found`);
          hasMore = false;
        }
      } catch (err) {
        console.error(`Error fetching page ${page}:`, err.message);
        // Don't stop on individual page errors, try to continue
        if (err.code === 'ECONNABORTED' || err.response?.status >= 500) {
          console.log(`Retrying page ${page} after error...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue; // Retry this page
        } else {
          hasMore = false; // Stop on client errors
        }
      }
    }
    
    const executionTime = Date.now() - startTime;
    console.log(`Pagination complete: ${allGames.length} games fetched in ${executionTime}ms`);
    
    // Create response in the expected format
    const gamesData = {
      count: allGames.length,
      results: allGames,
      next: null,
      previous: null,
      executionTime: executionTime,
      pagesProcessed: page - 1
    };
    
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
