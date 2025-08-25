const axios = require('axios');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { username } = req.query;
  if (!username) {
    res.status(400).json({ error: 'Username is required' });
    return;
  }
  try {
    const userResp = await axios.get(`https://online-go.com/api/v1/players?username=${username}`);
    if (!userResp.data.results || userResp.data.results.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const userId = userResp.data.results[0].id;
    const gamesResp = await axios.get(`https://online-go.com/api/v1/players/${userId}/games/`);
    res.json(gamesResp.data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};
