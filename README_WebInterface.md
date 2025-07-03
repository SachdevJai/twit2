# Twitter Scraper Web Interface

A simple web interface for the Twitter scraper that allows you to upload an influencers file and analyze your Twitter engagement.

## Features

- 🎨 Beautiful, modern web interface
- 📁 File upload for influencers list
- ⏱️ Real-time progress monitoring
- 📊 Download results in CSV and JSON formats
- 🔄 Automatic job status polling
- 📱 Responsive design

## Quick Start

1. **Start the server:**
   ```bash
   pnpm start
   ```

2. **Open your browser:**
   Navigate to `http://localhost:3000`

3. **Use the interface:**
   - Enter your Twitter username
   - Upload a `influencers.txt` file (one username per line)
   - Click "Start Scraping"
   - Monitor progress in real-time
   - Download results when complete

## File Format

Your `influencers.txt` file should contain one Twitter username per line:

```
elonmusk
BillGates
tim_cook
sundarpichai
```

## API Endpoints

The web interface uses these API endpoints:

- `POST /scrape` - Start a scraping job
- `GET /status/:jobId` - Check job status
- `GET /results/:jobId` - Get job results
- `GET /download/:filename` - Download result files

## Example Usage

1. Create a file called `influencers.txt` with your target influencers
2. Open `http://localhost:3000` in your browser
3. Enter your Twitter username
4. Upload the `influencers.txt` file
5. Click "Start Scraping"
6. Watch the progress bar and logs
7. Download your results when complete

## Output Files

The scraper generates several output files:

- **CSV File**: Summary analysis with reply rates and statistics
- **JSON File**: Complete analysis with all data
- **Unreplied Tweets**: List of tweets you haven't replied to

## Troubleshooting

- **File upload issues**: Make sure your file is a `.txt` file with one username per line
- **Server not starting**: Check that port 3000 is available
- **Scraping fails**: Ensure your `.env` file has valid Twitter credentials

## Development

To modify the interface:

- HTML/CSS/JS: `public/index.html`
- Server logic: `index.js`
- Scraping logic: `find_unreplied_tweets.js` 