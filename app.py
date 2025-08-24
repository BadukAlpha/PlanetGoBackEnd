# Backend for MyStats
# This file will serve as the entry point for the stats backend.

from flask import Flask, jsonify, request
from stats_fetcher import fetch_player_stats

app = Flask(__name__)

@app.route('/api/stats', methods=['GET'])
def get_stats():
    username = request.args.get('username')
    if not username:
        return jsonify({'error': 'Username is required'}), 400
    stats = fetch_player_stats(username)
    if stats is None:
        return jsonify({'error': 'Failed to fetch stats'}), 500
    return jsonify(stats)

if __name__ == '__main__':
    app.run(debug=True)
