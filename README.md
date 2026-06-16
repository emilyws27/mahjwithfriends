# 🀄 Mahjong Night

American Mahjong multiplayer — real-time WebSocket game for 1–4 players.

## Features
- **Kahoot-style rooms** — create a room, share the 4-letter code, friends join instantly
- **Real-time multiplayer** — WebSocket sync, all players see every discard and draw
- **AI fills empty seats** — play solo or with any number of friends (up to 4 total)
- **12 winning hands** — NMJL-style patterns from 25 to 50 points
- **Score tracker** — cumulative points across rounds, live leaderboard
- **AI hint system** — tap "AI hint" for strategic suggestions
- **Full instructions** — in-game rules + hand reference table
- **Charleston passing** — authentic 3-pass tile exchange before play

## Quick start (local)

```bash
npm install
npm start
# Open http://localhost:3000
```

Then open a second tab (or send to a friend on your local network using your IP) and join with the room code.

## Deploy free (pick one)

### Railway (easiest)
1. Push this folder to a GitHub repo
2. Go to railway.app → New Project → Deploy from GitHub
3. It auto-detects Node.js and sets `npm start`
4. Done — share the Railway URL with friends

### Render
1. Push to GitHub
2. render.com → New Web Service → Connect repo
3. Build command: `npm install`  
   Start command: `node server.js`
4. Free tier works fine for small groups

### Fly.io
```bash
npm install -g flyctl
fly launch
fly deploy
```

### Self-hosted VPS
```bash
git clone <your-repo>
cd mahjong-night
npm install
# With PM2 for process management:
npm install -g pm2
pm2 start server.js --name mahjong
pm2 save
```

> **Note:** For HTTPS (required for `wss://`), put Nginx or Caddy in front. Railway/Render/Fly handle this automatically.

## File structure

```
mahjong-night/
├── server.js          # WebSocket + HTTP server (game logic lives here)
├── package.json
├── README.md
└── public/
    ├── index.html     # Lobby — create/join rooms
    ├── game.html      # Game table
    └── style.css      # Shared styles
```

## How rooms work

1. Player creates a room → gets a 4-letter code (e.g. `KXQZ`)
2. Friends open the site and enter the code to join
3. Host clicks **Start game** (can start with 1–4 humans; AI fills empty seats)
4. After each round, host can start the next — scores accumulate across rounds

## Winning hands (points)

| Hand | Pts | How |
|------|-----|-----|
| Consecutive run | 25 | 5 consecutive tiles in one suit |
| All pairs | 25 | 7 matched pairs |
| Three-suit triplets | 30 | Same number as triplets in all 3 suits |
| Winds & dragons | 30 | 10+ wind and dragon tiles |
| Three kongs | 35 | Three sets of 4 identical tiles |
| Flowers & jokers | 35 | 4+ flowers and 4+ jokers |
| All one suit | 40 | 14 tiles in only one suit |
| Dragon pungs | 40 | Triplet of every dragon type |
| Wind sequence | 45 | Triplet of every wind type |
| Symmetrical hand | 45 | Matching number sequence in Bam & Dot |
| Quints | 50 | Two sets of 5 identical tiles (use jokers) |
| Lucky thirteen | 50 | 13 unique tile types + any 14th |
