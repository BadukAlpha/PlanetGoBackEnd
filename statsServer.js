// statsServer.js
// Simple Express server to fetch Go game stats from OGS for a given username


const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = 3001;

// Allow CORS for local dev and GitHub Pages
app.use(cors({
  origin: [
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'https://badukalpha.github.io',
    'https://planetgo-flame.vercel.app'
  ]
}));

app.get('/api/stats', async (req, res) => {
  const username = req.query.username;
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  try {
    // Get OGS user ID
    const userResp = await axios.get(`https://online-go.com/api/v1/players?username=${username}`);
    if (!userResp.data.results || userResp.data.results.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userId = userResp.data.results[0].id;
    // Get all games for user
    const gamesResp = await axios.get(`https://online-go.com/api/v1/players/${userId}/games/`);
    return res.json(gamesResp.data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.listen(PORT, () => {
  console.log(`Stats server running on port ${PORT}`);
});
