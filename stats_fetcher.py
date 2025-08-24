# stats_fetcher.py
# Handles fetching Go game stats for a user from OGS (Online Go Server)

import requests

def fetch_player_stats(username):
    """
    Fetches all game stats for a given OGS username.
    Returns a dictionary with stats or None if failed.
    """
    try:
        # OGS API endpoint for user info
        user_url = f'https://online-go.com/api/v1/players?username={username}'
        user_resp = requests.get(user_url)
        if user_resp.status_code != 200:
            return None
        user_data = user_resp.json()
        if not user_data['results']:
            return None
        user_id = user_data['results'][0]['id']

        # OGS API endpoint for game history
        games_url = f'https://online-go.com/api/v1/players/{user_id}/games/'
        games_resp = requests.get(games_url)
        if games_resp.status_code != 200:
            return None
        games_data = games_resp.json()

        # Return all raw game data for now
        return games_data
    except Exception as e:
        print(f"Error fetching stats: {e}")
        return None
