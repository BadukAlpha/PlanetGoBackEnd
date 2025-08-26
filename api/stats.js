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
    
    // Calculate comprehensive statistics (gotstats-style)
    const statistics = calculateComprehensiveStats(playerData, gamesData.results || []);
    
    // Return combined player, games, and calculated statistics
    res.json({
      player: playerData,
      games: gamesData,
      statistics: statistics,
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

// Calculate comprehensive statistics (gotstats-style)
function calculateComprehensiveStats(player, games) {
  if (!games || games.length === 0) {
    return {
      total: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      black: { games: 0, wins: 0, winRate: 0 },
      white: { games: 0, wins: 0, winRate: 0 },
      ranked: { games: 0, wins: 0, winRate: 0 },
      unranked: { games: 0, wins: 0, winRate: 0 },
      boardSizes: {},
      timeControls: {},
      opponents: { stronger: 0, equal: 0, weaker: 0 },
      outcomes: {
        resignation: { won: 0, lost: 0 },
        timeout: { won: 0, lost: 0 },
        score: { won: 0, lost: 0 },
        disconnection: { won: 0, lost: 0 }
      },
      rankProgression: []
    };
  }

  const stats = {
    total: games.length,
    wins: 0,
    losses: 0,
    black: { games: 0, wins: 0 },
    white: { games: 0, wins: 0 },
    ranked: { games: 0, wins: 0 },
    unranked: { games: 0, wins: 0 },
    boardSizes: {},
    timeControls: {},
    opponents: { stronger: 0, equal: 0, weaker: 0 },
    outcomes: {
      resignation: { won: 0, lost: 0 },
      timeout: { won: 0, lost: 0 },
      score: { won: 0, lost: 0 },
      disconnection: { won: 0, lost: 0 }
    },
    rankProgression: []
  };

  // Process games in chronological order for rank progression
  const sortedGames = [...games].sort((a, b) => 
    new Date(a.ended || a.started) - new Date(b.ended || b.started)
  );

  sortedGames.forEach((game, index) => {
    // Determine if player is black or white using the actual OGS data structure
    const isBlack = game.black === player.id || 
                   (game.players && game.players.black && game.players.black.id === player.id) ||
                   (game.black_player && game.black_player.id === player.id);
    
    // Determine if player won using OGS game result structure
    let isWin = false;
    let outcomeType = 'unknown';
    
    if (game.outcome) {
      // Parse outcome string (e.g., "B+R", "W+T", "B+0.5", etc.)
      if (isBlack) {
        isWin = game.outcome.includes('B+');
      } else {
        isWin = game.outcome.includes('W+');
      }
      
      // Determine outcome type
      if (game.outcome.includes('+R')) {
        outcomeType = 'resignation';
      } else if (game.outcome.includes('+T')) {
        outcomeType = 'timeout';
      } else if (game.outcome.includes('+F')) {
        outcomeType = 'disconnection';
      } else if (game.outcome.match(/\+\d/)) {
        outcomeType = 'score';
      }
    } else if (typeof game.black_lost !== 'undefined') {
      isWin = isBlack ? !game.black_lost : game.black_lost;
    } else if (typeof game.white_lost !== 'undefined') {
      isWin = isBlack ? game.white_lost : !game.white_lost;
    }

    if (isWin) {
      stats.wins++;
      if (stats.outcomes[outcomeType]) {
        stats.outcomes[outcomeType].won++;
      }
    } else {
      stats.losses++;
      if (stats.outcomes[outcomeType]) {
        stats.outcomes[outcomeType].lost++;
      }
    }

    // Color stats
    if (isBlack) {
      stats.black.games++;
      if (isWin) stats.black.wins++;
    } else {
      stats.white.games++;
      if (isWin) stats.white.wins++;
    }

    // Ranked vs Unranked
    if (game.ranked) {
      stats.ranked.games++;
      if (isWin) stats.ranked.wins++;
    } else {
      stats.unranked.games++;
      if (isWin) stats.unranked.wins++;
    }

    // Board sizes
    const size = `${game.width || 19}×${game.height || 19}`;
    if (!stats.boardSizes[size]) {
      stats.boardSizes[size] = { games: 0, wins: 0 };
    }
    stats.boardSizes[size].games++;
    if (isWin) stats.boardSizes[size].wins++;

    // Time controls
    let timeControl = 'Unknown';
    if (game.time_control) {
      if (typeof game.time_control === 'string') {
        timeControl = game.time_control;
      } else if (game.time_control.system) {
        timeControl = game.time_control.system;
      }
    }
    if (!stats.timeControls[timeControl]) {
      stats.timeControls[timeControl] = { games: 0, wins: 0 };
    }
    stats.timeControls[timeControl].games++;
    if (isWin) stats.timeControls[timeControl].wins++;

    // Opponent strength analysis
    let opponent = null;
    if (game.players) {
      opponent = isBlack ? game.players.white : game.players.black;
    } else if (game.black_player && game.white_player) {
      opponent = isBlack ? game.white_player : game.black_player;
    }

    if (opponent && opponent.rating && player.rating) {
      const playerRating = player.rating;
      const opponentRating = opponent.rating;
      const ratingDiff = opponentRating - playerRating;
      
      if (ratingDiff > 100) {
        stats.opponents.stronger++;
      } else if (Math.abs(ratingDiff) <= 100) {
        stats.opponents.equal++;
      } else {
        stats.opponents.weaker++;
      }
    }

    // Rank progression (simplified - would need historical rating data for full implementation)
    if (game.historical_ratings && (index % 10 === 0)) {
      const playerRating = isBlack ? 
        game.historical_ratings.black?.rating : 
        game.historical_ratings.white?.rating;
      if (playerRating) {
        stats.rankProgression.push({
          game: index + 1,
          rating: playerRating,
          date: game.ended || game.started
        });
      }
    }
  });

  // Calculate win rates
  stats.winRate = stats.total > 0 ? (stats.wins / stats.total) * 100 : 0;
  stats.black.winRate = stats.black.games > 0 ? (stats.black.wins / stats.black.games) * 100 : 0;
  stats.white.winRate = stats.white.games > 0 ? (stats.white.wins / stats.white.games) * 100 : 0;
  stats.ranked.winRate = stats.ranked.games > 0 ? (stats.ranked.wins / stats.ranked.games) * 100 : 0;
  stats.unranked.winRate = stats.unranked.games > 0 ? (stats.unranked.wins / stats.unranked.games) * 100 : 0;

  // Calculate board size win rates
  Object.keys(stats.boardSizes).forEach(size => {
    const data = stats.boardSizes[size];
    data.winRate = data.games > 0 ? (data.wins / data.games) * 100 : 0;
  });

  // Calculate time control win rates
  Object.keys(stats.timeControls).forEach(control => {
    const data = stats.timeControls[control];
    data.winRate = data.games > 0 ? (data.wins / data.games) * 100 : 0;
  });

  return stats;
}
