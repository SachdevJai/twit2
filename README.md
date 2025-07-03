# Twitter Scraper API

A web-based Twitter scraper that analyzes influencer tweets and finds unreplied tweets from your account.

## Features

- **Web Interface**: Modern UI with real-time progress updates
- **Comprehensive Analysis**: Tracks tweets, replies, and engagement metrics
- **File Storage**: Saves results as JSON and CSV files
- **Job Management**: Track and manage multiple scraping jobs
- **Real-time Updates**: Live logs and progress via WebSocket
- **Error Handling**: Robust error handling and retry logic

## Quick Start

### Prerequisites

- Node.js 18+ 
- pnpm (recommended) or npm
- Chrome/Chromium browser (optional - Puppeteer will download its own if not found)

### Installation

1. **Clone or create a fresh repository**
   ```bash
   git clone <your-repo-url>
   cd twitter-scraper-api
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   # or
   npm install
   ```

3. **Start the server**
   ```bash
   pnpm start
   # or
   npm start
   ```

The server will automatically:
- Create all necessary directories
- Initialize the environment
- Start the web interface

### Usage

1. **Open the web interface**: http://localhost:3000

2. **Upload influencers file**: Create a text file with one Twitter username per line:
   ```
   elonmusk
   twitter
   github
   ```

3. **Enter your username**: The Twitter username you want to analyze replies for

4. **Set analysis period**: Number of days to look back (default: 30)

5. **Start scraping**: Click "Start Analysis" and watch real-time progress

## Directory Structure

```
twitter-scraper-api/
├── data/                    # Created automatically
│   ├── cookies/            # Browser cookies
│   ├── tweets/             # Raw tweet data
│   ├── csv/                # Analysis CSV files
│   ├── analysis/           # JSON analysis files
│   ├── uploads/            # Uploaded influencer files
│   └── jobs.json           # Job history
├── index.js                # Main server file
├── package.json            # Dependencies
└── README.md               # This file
```

## API Endpoints

- `GET /` - Web interface
- `POST /scrape` - Start scraping job
- `GET /status/:jobId` - Get job status
- `GET /jobs` - List all jobs
- `DELETE /jobs/:id` - Delete a job
- `GET /download/*` - Download result files
- `GET /health` - Health check

## File Outputs

For each scraping job, the system generates:

- **My Replies**: `data/tweets/{username}_my_replies.json`
- **Influencer Tweets**: `data/tweets/{influencer}_tweets.json`
- **Unreplied Tweets**: `data/tweets/{influencer}_unreplied_tweets.json`
- **Analysis**: `data/analysis/{username}_complete_analysis.json`
- **CSV Report**: `data/csv/{username}_influencer_analysis.csv`

## Troubleshooting

### Common Issues

1. **"data directory doesn't exist"**
   - The server should create this automatically
   - Run `pnpm start` instead of `node index.js`

2. **Permission errors**
   - Ensure you have write permissions in the project directory

3. **Chrome/Chromium not found**
   - Puppeteer will download its own version automatically
   - This may take a few minutes on first run

4. **Port already in use**
   - Change the port: `PORT=3001 pnpm start`
   - Or kill existing process: `pkill -f "node.*index.js"`

### Development

```bash
# Development mode with auto-restart
pnpm dev

# Direct server start (bypasses startup checks)
node index.js
```

## Environment Variables

- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)

## Production Deployment

For production deployment, consider:

1. **Process Manager**: Use PM2 or similar
2. **Reverse Proxy**: Nginx or Apache
3. **SSL**: HTTPS certificates
4. **Monitoring**: Log rotation and monitoring
5. **Backup**: Regular backup of `data/` directory

