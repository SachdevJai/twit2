# Twitter Influencer Engagement Analyzer

A Node.js script that analyzes your Twitter engagement with influencers by finding tweets you haven't replied to and generating comprehensive reports.

## Features

- 🔍 **Scrapes your replies** from the last 7 days
- 📊 **Analyzes influencer tweets** from your target list
- ⚡ **Smart scraper rotation** to avoid rate limits
- 🕐 **Robust timeout handling** prevents getting stuck
- 📈 **Generates multiple reports** (JSON, CSV)
- 🎯 **Identifies unreplied tweets** for engagement opportunities

## Prerequisites

- Node.js (v16 or higher)
- Twitter accounts
- Environment variables configured

## Installation

1. **Clone or download the project**
2. **Install dependencies:**
   ```bash
   pnpm install
   ```

## Environment Setup

Create a `.env` file in the project root with your Twitter credentials:

```env
# Account 1
TWT_USERNAME1=your_username_1
TWT_PASSWORD1=your_password_1
TWT_EMAIL1=your_email_1

# Account 2 (optional - add as many as you need)
TWT_USERNAME2=your_username_2
TWT_PASSWORD2=your_password_2
TWT_EMAIL2=your_email_2

# Account 3 (optional)
TWT_USERNAME3=your_username_3
TWT_PASSWORD3=your_password_3
TWT_EMAIL3=your_email_3

# Add more accounts as needed (TWT_USERNAME4, TWT_USERNAME5, etc.)
```

**Auto-Detection**: The script automatically detects how many accounts you have configured and only initializes valid ones. You can add up to 20 accounts (TWT_USERNAME1 through TWT_USERNAME20).

**Cookie Validation**: The script checks for existing cookie files (`cookies1.json`, `cookies2.json`, etc.) and validates them. If cookies are expired or missing, it will attempt to log in using your credentials.

**Testing**: Run `node test_scraper_detection.js` to test your account configuration before running the main script.

## Influencers List

Create an `influencers.txt` file with one Twitter username per line:

```txt
influencer1
influencer2
influencer3
another_influencer
crypto_expert
tech_guru
```

**Format:**
- One username per line
- No @ symbols needed
- Empty lines are ignored
- Case insensitive

## Usage

### 1. Test Your Configuration
First, test that your accounts are properly configured:

```bash
node test_scraper_detection.js
```

This will show you how many scrapers were detected and initialized.

### 2. Run the Analysis
Run the script with your Twitter username:

```bash
node find_unreplied_tweets.js your_username
```

**Example:**
```bash
node find_unreplied_tweets.js maeveknows
```

The script will automatically:
- Detect how many accounts you have configured
- Validate existing cookie sessions
- Initialize only valid scrapers
- Show you which accounts are being used

## How It Works

### Step 1: Authentication
- Loads cookies from `cookies1.json`, `cookies2.json`, `cookies3.json`
- If cookies are invalid, logs in using environment variables
- Saves new cookies for future use

### Step 2: Data Collection
- **Your Replies**: Scrapes your replies from the last 7 days
- **Influencer Tweets**: Scrapes tweets from each influencer in your list
- **Smart Rotation**: Switches between scrapers every 8 influencers to avoid rate limits
- **Timeout Protection**: 60-second timeout per influencer, 2-minute timeout for replies

### Step 3: Analysis
- Matches your replies to influencer tweets
- Identifies tweets you haven't replied to
- Calculates engagement metrics

## Output Files

The script generates several files:

### 1. `{username}_my_replies.json`
Your replies from the last 7 days.

### 2. `{username}_influencer_tweets.json`
Optimized influencer tweets data (essential fields only).

### 3. `{username}_influencer_analysis.csv`
Analysis summary with columns:
- Influencer
- Number of Tweets
- Number of Replies
- Unreplied Count
- Average Reply Time (minutes)
- Tweet Mentions
- Reply Rate

### 4. `{username}_unreplied_tweets.json`
**Most important file** - All tweets you haven't replied to:
```json
[
  {
    "influencer": "crypto_expert",
    "id": "1234567890",
    "text": "Bitcoin is looking bullish today!",
    "timestamp": 1640995200000,
    "timeParsed": "2022-01-01T12:00:00.000Z",
    "url": "https://twitter.com/crypto_expert/status/1234567890",
    "likes": 150,
    "retweets": 25,
    "replies": 10
  }
]
```

### 5. `{username}_complete_analysis.json`
Comprehensive analysis with summary statistics.

## Rate Limit Management

The script uses several strategies to avoid rate limits:

- **Proactive Scraper Rotation**: Switches every 8 influencers
- **Delays**: 5 seconds between influencers, 10 seconds after switching
- **Timeout Protection**: Never gets stuck on a single request
- **Multiple Accounts**: Uses up to 3 Twitter accounts

## Troubleshooting

### Script Gets Stuck
- The script now has robust timeout handling
- If it still gets stuck, kill the process and restart
- Check your internet connection

### Authentication Errors
- Ensure your `.env` file is correctly formatted
- Verify your Twitter credentials
- Check if your accounts are locked or suspended

### Rate Limit Errors
- The script automatically handles rate limits
- If you see many errors, consider adding more Twitter accounts
- Increase delays between requests if needed

### No Data Found
- Check if influencers in your list are active
- Verify the date range (last 7 days)
- Ensure your Twitter account has the necessary permissions

## Customization

### Change Time Range
Edit line 6 in `find_unreplied_tweets.js`:
```javascript
const sinceDate = dayjs().subtract(7, 'day').format('YYYY-MM-DD');
```

### Adjust Timeouts
Modify these constants:
```javascript
const SWITCH_EVERY_N_REQUESTS = 8; // Switch scrapers every 8 influencers
const GLOBAL_TIMEOUT = 300000; // 5 minutes global timeout
```

### Change Number of Scrapers
Modify line 345:
```javascript
const scraperManager = new ScraperManager(3); // Use 3 scrapers
```

## Example Output

```
=== ANALYSIS COMPLETE ===
Total influencer tweets: 15,234
Your replies: 396
Total unreplied tweets: 14,838
Influencers analyzed: 572

Files created:
- maeveknows_my_replies.json
- maeveknows_influencer_tweets.json
- maeveknows_influencer_analysis.csv
- maeveknows_unreplied_tweets.json
- maeveknows_complete_analysis.json

=== TOP 5 INFLUENCERS (PREVIEW) ===
1. crypto_expert: 45 replies, 155 unreplied (22.5% rate)
2. tech_guru: 32 replies, 98 unreplied (24.6% rate)
3. influencer1: 28 replies, 120 unreplied (18.9% rate)
```

## Security Notes

- Never commit your `.env` file to version control
- Keep your cookie files secure
- Use dedicated Twitter accounts for automation
- Respect Twitter's terms of service

## Dependencies

- `@the-convocation/twitter-scraper`: Twitter scraping library
- `dayjs`: Date manipulation
- `dotenv`: Environment variable management

