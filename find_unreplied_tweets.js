import { Scraper, SearchMode, ErrorRateLimitStrategy } from "@the-convocation/twitter-scraper";
import fs from "fs";
import dayjs from "dayjs";
import { argv } from "process";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Debug: Check if .env file exists and show some environment variables
console.log('Environment check:');
console.log('- .env file exists:', fs.existsSync('.env'));
console.log('- TWT_USERNAME1:', process.env.TWT_USERNAME1 ? '✓ Found' : '✗ Not found');
console.log('- TWT_PASSWORD1:', process.env.TWT_PASSWORD1 ? '✓ Found' : '✗ Not found');
console.log('- TWT_EMAIL1:', process.env.TWT_EMAIL1 ? '✓ Found' : '✗ Not found');
console.log('');

class ScraperManager {
  constructor(numScrapers = 2) {
    this.scrapers = [];
    this.currentIndex = 0;
    this.numScrapers = numScrapers;
    this.sessionStartTimes = [];
    this.requestCounts = [];
    this.lastRefreshTimes = [];
    this.accountNumbers = []; // Track which account number each scraper corresponds to
    this.timeoutCounts = []; // Track timeouts per scraper
    this.responseTimes = []; // Track average response times
    this.lastRequestTimes = []; // Track when each scraper was last used
    this.errorCounts = []; // Track consecutive errors per scraper
    this.circuitBreakerStates = []; // Track circuit breaker state per scraper
    this.rateLimitInfo = []; // Track rate limit info per scraper
    this.SESSION_TIMEOUT = 1800000; // 30 minutes
    this.REQUESTS_BEFORE_REFRESH = 50; // Refresh after 50 requests
    this.MAX_CONSECUTIVE_ERRORS = 5; // Circuit breaker threshold
    this.CIRCUIT_BREAKER_TIMEOUT = 300000; // 5 minutes circuit breaker timeout
    this.MIN_REQUEST_INTERVAL = 2000; // Minimum 2 seconds between requests
    this.RATE_LIMIT_COOLDOWN = 60000; // 1 minute cooldown after rate limit
  }

  async initialize() {
    console.log(`Detecting available scrapers from environment...`);
    
    // Detect number of available scrapers from environment
    const availableScrapers = await this.detectAvailableScrapers();
    
    if (availableScrapers.length === 0) {
      throw new Error('No valid scrapers found. Please check your .env file and ensure at least one account has valid credentials.');
    }
    
    console.log(`Found ${availableScrapers.length} valid scrapers, initializing...`);
    
    for (let i = 0; i < availableScrapers.length; i++) {
      const accountNumber = availableScrapers[i];
      const scraper = await getScraper(accountNumber);
      if (scraper) {
        this.scrapers.push(scraper);
        this.accountNumbers.push(accountNumber); // Store the account number
        this.sessionStartTimes.push(Date.now());
        this.requestCounts.push(0);
        this.lastRefreshTimes.push(Date.now());
        this.timeoutCounts.push(0); // Initialize timeout counter
        this.responseTimes.push([]); // Initialize response time tracking
        this.lastRequestTimes.push(0); // Initialize last request time
        this.errorCounts.push(0); // Initialize error counter
        this.circuitBreakerStates.push({ state: 'CLOSED', lastFailureTime: 0 }); // Initialize circuit breaker
        this.rateLimitInfo.push({ 
          remaining: 1200, 
          limit: 1200, 
          resetTime: 0,
          lastRateLimitTime: 0 
        }); // Initialize rate limit info
        console.log(`Scraper ${accountNumber} initialized`);
      }
    }

    if (this.scrapers.length === 0) {
      throw new Error('No scrapers could be initialized');
    }
    
    console.log(`✅ Successfully initialized ${this.scrapers.length} scrapers`);
  }

  async detectAvailableScrapers() {
    const availableScrapers = [];
    
    console.log('Checking environment variables...');
    
    // Check for up to 20 potential scrapers (TWT_USERNAME1 through TWT_USERNAME20)
    for (let i = 1; i <= 20; i++) {
      const username = process.env[`TWT_USERNAME${i}`];
      const password = process.env[`TWT_PASSWORD${i}`];
      const email = process.env[`TWT_EMAIL${i}`];
      
      console.log(`Account ${i}: username=${username ? '✓' : '✗'}, password=${password ? '✓' : '✗'}, email=${email ? '✓' : '✗'}`);
      
      // Check if all three credentials are present
      if (username && password && email) {
        // Check if cookies exist and are valid
        const cookiesFile = `data/cookies/cookies${i}.json`;
        const hasValidCookies = await this.checkCookiesValidity(cookiesFile);
        
        if (hasValidCookies) {
          console.log(`  ✓ Account ${i}: Valid cookies found`);
          availableScrapers.push(i);
        } else {
          console.log(`  ⚠ Account ${i}: Credentials found but no valid cookies`);
          // Still add it as available (will try to login)
          availableScrapers.push(i);
        }
      } else if (username || password || email) {
        console.log(`  ❌ Account ${i}: Incomplete credentials (missing: ${!username ? 'username' : ''}${!password ? ' password' : ''}${!email ? ' email' : ''})`);
      }
    }
    
    console.log(`\nFound ${availableScrapers.length} accounts with complete credentials`);
    return availableScrapers;
  }

  async checkCookiesValidity(cookiesFile) {
    try {
      if (!fs.existsSync(cookiesFile)) {
        return false;
      }
      
      const cookies = JSON.parse(fs.readFileSync(cookiesFile, 'utf-8'));
      
      // Check if cookies are recent (less than 7 days old)
      if (cookies.length > 0 && cookies[0].expires) {
        const cookieAge = Date.now() - new Date(cookies[0].expires).getTime();
        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
        
        if (cookieAge > maxAge) {
          console.log(`    ⚠ Cookies for ${cookiesFile} are expired`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.log(`    ❌ Error checking cookies for ${cookiesFile}: ${error.message}`);
      return false;
    }
  }

  getCurrentScraper() {
    return this.scrapers[this.currentIndex];
  }

  getCurrentAccountNumber() {
    return this.accountNumbers[this.currentIndex];
  }

  switchScraper() {
    this.currentIndex = (this.currentIndex + 1) % this.scrapers.length;
    console.log(`Switched to scraper ${this.accountNumbers[this.currentIndex]}`);
  }

  async refreshSession(scraperIndex) {
    const accountNumber = this.accountNumbers[scraperIndex];
    console.log(`🔄 Refreshing session for scraper ${accountNumber}...`);
    
    try {
      // Get current scraper
      const currentScraper = this.scrapers[scraperIndex];
      
      // Properly close the current session
      await currentScraper.close();
      
      // Wait a moment for cleanup
      await sleep(5000);
      
      // Get fresh scraper with new session
      const newScraper = await getScraper(accountNumber);
      
      if (newScraper) {
        this.scrapers[scraperIndex] = newScraper;
        this.sessionStartTimes[scraperIndex] = Date.now();
        this.requestCounts[scraperIndex] = 0;
        this.lastRefreshTimes[scraperIndex] = Date.now();
        console.log(`✅ Session refreshed for scraper ${accountNumber}`);
        return true;
      } else {
        console.log(`❌ Failed to refresh session for scraper ${accountNumber}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Error refreshing session for scraper ${accountNumber}:`, error.message);
      return false;
    }
  }

  async checkAndRefreshSession() {
    const currentScraperIndex = this.currentIndex;
    const sessionAge = Date.now() - this.sessionStartTimes[currentScraperIndex];
    const requestCount = this.requestCounts[currentScraperIndex];
    const timeSinceLastRefresh = Date.now() - this.lastRefreshTimes[currentScraperIndex];
    
    // Check if session needs refresh
    const needsRefresh = 
      sessionAge > this.SESSION_TIMEOUT || 
      requestCount > this.REQUESTS_BEFORE_REFRESH ||
      timeSinceLastRefresh > this.SESSION_TIMEOUT;
    
    if (needsRefresh) {
      console.log(`⚠ Session refresh needed for scraper ${this.accountNumbers[currentScraperIndex]} (age: ${Math.round(sessionAge/1000)}s, requests: ${requestCount})`);
      
      const refreshSuccess = await this.refreshSession(currentScraperIndex);
      
      if (!refreshSuccess) {
        // If refresh failed, try switching to another scraper
        console.log(`🔄 Switching to next scraper due to refresh failure`);
        this.switchScraper();
      }
      
      return refreshSuccess;
    }
    
    return true;
  }

    async makeRequest(requestFn, timeoutMs = 5000, maxRetries = 3) {
    // Select the best performing scraper
    this.selectBestScraper();
    
    // Check if current session needs refresh
    await this.checkAndRefreshSession();
    
    // Check rate limits and enforce cooldowns
    const currentScraperIndex = this.currentIndex;
    const rateLimitInfo = this.rateLimitInfo[currentScraperIndex];
    const now = Date.now();
    
    // Check if we're in rate limit cooldown
    if (now - rateLimitInfo.lastRateLimitTime < this.RATE_LIMIT_COOLDOWN) {
      const cooldownRemaining = this.RATE_LIMIT_COOLDOWN - (now - rateLimitInfo.lastRateLimitTime);
      console.log(`⏳ Rate limit cooldown active for scraper ${this.accountNumbers[currentScraperIndex]}, waiting ${Math.round(cooldownRemaining/1000)}s...`);
      await sleep(cooldownRemaining);
    }
    
    // Check minimum interval between requests
    const timeSinceLastRequest = now - this.lastRequestTimes[currentScraperIndex];
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
      const waitTime = this.MIN_REQUEST_INTERVAL - timeSinceLastRequest;
      console.log(`⏳ Enforcing minimum interval for scraper ${this.accountNumbers[currentScraperIndex]}, waiting ${Math.round(waitTime/1000)}s...`);
      await sleep(waitTime);
    }
    
    // Check if rate limit is reset
    if (rateLimitInfo.resetTime > 0 && now >= rateLimitInfo.resetTime) {
      console.log(`🔄 Rate limit reset for scraper ${this.accountNumbers[currentScraperIndex]}`);
      rateLimitInfo.remaining = rateLimitInfo.limit;
      rateLimitInfo.resetTime = 0;
    }
    
    // Check if we have remaining requests
    if (rateLimitInfo.remaining <= 0) {
      console.log(`⚠ Rate limit exhausted for scraper ${this.accountNumbers[currentScraperIndex]}, switching...`);
      this.switchScraper();
      return this.makeRequest(requestFn, timeoutMs, maxRetries);
    }
    
    // Increment request count and record start time
    this.requestCounts[this.currentIndex]++;
    const requestStartTime = Date.now();
    this.lastRequestTimes[this.currentIndex] = requestStartTime;
    
    for (let retry = 0; retry <= maxRetries; retry++) {
      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('timeout')), timeoutMs)
        );
        
        const requestPromise = requestFn(this.getCurrentScraper());
        const result = await Promise.race([requestPromise, timeoutPromise]);
        
        // Record successful response time
        const responseTime = Date.now() - requestStartTime;
        this.responseTimes[this.currentIndex].push(responseTime);
        
        // Keep only last 10 response times to avoid memory bloat
        if (this.responseTimes[this.currentIndex].length > 10) {
          this.responseTimes[this.currentIndex] = this.responseTimes[this.currentIndex].slice(-10);
        }
        
        // Decrement remaining requests
        this.rateLimitInfo[this.currentIndex].remaining = Math.max(0, this.rateLimitInfo[this.currentIndex].remaining - 1);
        
        // Record success for circuit breaker
        this.recordSuccess(this.currentIndex);
        
        return result;
        
      } catch (error) {
        const isLastRetry = retry === maxRetries;
        
        if (error.message === 'timeout' || error.message.includes('Rate limit exceeded')) {
          // Increment timeout count for this scraper
          this.timeoutCounts[this.currentIndex]++;
          
          // Record failure for circuit breaker
          this.recordFailure(this.currentIndex);
          
          // Parse rate limit headers if available
          if (error.message.includes('Rate limit exceeded') && error.headers) {
            this.parseRateLimitHeaders(error.headers, this.currentIndex);
          }
          
          console.log(`Request failed on scraper ${this.accountNumbers[this.currentIndex]} (attempt ${retry + 1}/${maxRetries + 1}): ${error.message}`);
          
          if (isLastRetry) {
            console.log(`All retries exhausted for scraper ${this.accountNumbers[this.currentIndex]}`);
            return null;
          }
          
          // For rate limits, use longer backoff and switch scraper immediately
          if (error.message.includes('Rate limit exceeded')) {
            const backoffTime = Math.min(10000 * Math.pow(2, retry), 60000); // 10s, 20s, 40s
            console.log(`Rate limit hit, waiting ${backoffTime/1000}s before retry...`);
            await sleep(backoffTime);
            
            // Switch to next scraper for retry
            this.switchScraper();
            continue;
          }
          
          // For timeouts, use shorter backoff
          const backoffTime = Math.min(5000 * Math.pow(2, retry), 30000);
          console.log(`Timeout, waiting ${backoffTime/1000}s before retry...`);
          await sleep(backoffTime);
          
          // Switch to next scraper for retry
          this.switchScraper();
          continue;
        }
        
        // For other errors, throw immediately
        throw error;
      }
    }
    
        return null;
  }

  getSessionStats() {
    return this.scrapers.map((_, index) => {
      const avgResponseTime = this.responseTimes[index].length > 0 
        ? Math.round(this.responseTimes[index].reduce((a, b) => a + b, 0) / this.responseTimes[index].length / 1000)
        : 0;
      
      const rateLimitInfo = this.rateLimitInfo[index];
      const timeUntilReset = rateLimitInfo.resetTime > 0 ? Math.max(0, Math.round((rateLimitInfo.resetTime - Date.now()) / 1000)) : 0;
      
      return {
        scraper: this.accountNumbers[index],
        sessionAge: Math.round((Date.now() - this.sessionStartTimes[index]) / 1000),
        requestCount: this.requestCounts[index],
        timeSinceRefresh: Math.round((Date.now() - this.lastRefreshTimes[index]) / 1000),
        timeouts: this.timeoutCounts[index],
        avgResponseTime: avgResponseTime,
        timeSinceLastUse: Math.round((Date.now() - this.lastRequestTimes[index]) / 1000),
        rateLimit: `${rateLimitInfo.remaining}/${rateLimitInfo.limit}`,
        timeUntilReset: timeUntilReset
      };
    });
  }

  // Smart scraper selection based on performance
  selectBestScraper() {
    const now = Date.now();
    const scraperScores = [];
    
    for (let i = 0; i < this.scrapers.length; i++) {
      let score = 100; // Base score
      
      // Check circuit breaker state
      const circuitBreaker = this.circuitBreakerStates[i];
      if (circuitBreaker.state === 'OPEN') {
        // Check if circuit breaker timeout has passed
        if (now - circuitBreaker.lastFailureTime > this.CIRCUIT_BREAKER_TIMEOUT) {
          circuitBreaker.state = 'HALF_OPEN';
          console.log(`🔄 Circuit breaker for scraper ${this.accountNumbers[i]} moved to HALF_OPEN`);
        } else {
          score = -1000; // Heavily penalize open circuit breakers
        }
      }
      
      // Penalize for timeouts (major penalty)
      const timeoutPenalty = this.timeoutCounts[i] * 30;
      score -= timeoutPenalty;
      
      // Penalize for consecutive errors
      const errorPenalty = this.errorCounts[i] * 20;
      score -= errorPenalty;
      
      // Penalize for recent use (cooldown)
      const timeSinceLastUse = now - this.lastRequestTimes[i];
      if (timeSinceLastUse < 10000) { // Less than 10 seconds
        score -= 20;
      }
      
      // Bonus for longer time since last use
      if (timeSinceLastUse > 30000) { // More than 30 seconds
        score += 10;
      }
      
      // Penalize for slow average response time
      if (this.responseTimes[i].length > 0) {
        const avgResponseTime = this.responseTimes[i].reduce((a, b) => a + b, 0) / this.responseTimes[i].length;
        if (avgResponseTime > 30000) { // More than 30 seconds average
          score -= 15;
        }
      }
      
      // Heavy penalty for very high timeout count
      if (this.timeoutCounts[i] >= 5) {
        score -= 50;
      }
      
      // Rate limit considerations
      const rateLimitInfo = this.rateLimitInfo[i];
      if (rateLimitInfo.remaining <= 0) {
        score -= 1000; // Heavy penalty for exhausted rate limits
      } else if (rateLimitInfo.remaining < 100) {
        score -= 20; // Penalty for low remaining requests
      } else {
        score += 10; // Bonus for high remaining requests
      }
      
      // Penalty for recent rate limit hits
      const timeSinceRateLimit = Date.now() - rateLimitInfo.lastRateLimitTime;
      if (timeSinceRateLimit < this.RATE_LIMIT_COOLDOWN) {
        score -= 50;
      }
      
      scraperScores.push({ index: i, score: Math.max(0, score) });
    }
    
    // Sort by score (highest first)
    scraperScores.sort((a, b) => b.score - a.score);
    
    // Select the best scraper
    const bestScraperIndex = scraperScores[0].index;
    
    if (bestScraperIndex !== this.currentIndex) {
      console.log(`🔄 Switching to best performing scraper: ${this.accountNumbers[bestScraperIndex]} (score: ${scraperScores[0].score})`);
      this.currentIndex = bestScraperIndex;
    }
    
    return bestScraperIndex;
  }
  
  // Record success for circuit breaker
  recordSuccess(scraperIndex) {
    this.errorCounts[scraperIndex] = 0;
    this.circuitBreakerStates[scraperIndex] = { state: 'CLOSED', lastFailureTime: 0 };
  }
  
  // Record failure for circuit breaker
  recordFailure(scraperIndex) {
    this.errorCounts[scraperIndex]++;
    const circuitBreaker = this.circuitBreakerStates[scraperIndex];
    
    if (this.errorCounts[scraperIndex] >= this.MAX_CONSECUTIVE_ERRORS) {
      circuitBreaker.state = 'OPEN';
      circuitBreaker.lastFailureTime = Date.now();
      console.log(`🚨 Circuit breaker OPEN for scraper ${this.accountNumbers[scraperIndex]} (${this.errorCounts[scraperIndex]} consecutive errors)`);
    }
  }
  
  // Parse rate limit headers from Twitter response
  parseRateLimitHeaders(headers, scraperIndex) {
    const rateLimitInfo = this.rateLimitInfo[scraperIndex];
    
    try {
      // Parse headers string (format: "header1: value1\nheader2: value2")
      const headerLines = headers.split('\n');
      const headerMap = {};
      
      headerLines.forEach(line => {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim().toLowerCase();
          const value = line.substring(colonIndex + 1).trim();
          headerMap[key] = value;
        }
      });
      
      // Extract rate limit information
      if (headerMap['x-rate-limit-remaining']) {
        rateLimitInfo.remaining = parseInt(headerMap['x-rate-limit-remaining']);
      }
      
      if (headerMap['x-rate-limit-limit']) {
        rateLimitInfo.limit = parseInt(headerMap['x-rate-limit-limit']);
      }
      
      if (headerMap['x-rate-limit-reset']) {
        rateLimitInfo.resetTime = parseInt(headerMap['x-rate-limit-reset']) * 1000; // Convert to milliseconds
      }
      
      rateLimitInfo.lastRateLimitTime = Date.now();
      
      console.log(`📊 Rate limit info for scraper ${this.accountNumbers[scraperIndex]}: ${rateLimitInfo.remaining}/${rateLimitInfo.limit} remaining, resets at ${new Date(rateLimitInfo.resetTime).toISOString()}`);
      
    } catch (error) {
      console.log(`⚠ Could not parse rate limit headers for scraper ${this.accountNumbers[scraperIndex]}: ${error.message}`);
    }
  }
}

async function getScraper(accountNumber = 1) {
  const scraper = new Scraper({
    rateLimitStrategy: new ErrorRateLimitStrategy(),
    // Add request timeout
    fetch: (input, init) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      return fetch(input, { ...init, signal: controller.signal })
        .finally(() => clearTimeout(timeoutId));
    }
  });
  const cookiesFile = `data/cookies/cookies${accountNumber}.json`;
  const cookies = fs.existsSync(cookiesFile) ? JSON.parse(fs.readFileSync(cookiesFile, 'utf-8')) : null;

  if(cookies) {
    console.log(`cookies found for account ${accountNumber}, trying to login`);
    const cookiestrings = cookies.map((cookie) => 
      `${cookie.key}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}; ${cookie.secure ? 'Secure' : ''}; ${cookie.httpOnly ? 'httpOnly': ''}; SameSite=${cookie.sameSite || 'Lax'}`
    );
    await scraper.setCookies(cookiestrings);
  }

  const isloggedin = await scraper.isLoggedIn();

  const usernamevar = "TWT_USERNAME" + accountNumber;
  const passwordvar = "TWT_PASSWORD" + accountNumber;
  const emailvar = "TWT_EMAIL" + accountNumber;

  if(!isloggedin) {
    console.log(`cookies failed for account ${accountNumber}, logging in using creds`);
    await scraper.login(process.env[usernamevar], process.env[passwordvar], process.env[emailvar]);
  }

  const newcookies = await scraper.getCookies();
  fs.writeFileSync(cookiesFile, JSON.stringify(newcookies));
  console.log(`saved new cookies for account ${accountNumber}`);

  const res = await scraper.isLoggedIn();
  if(res) return scraper;
  return null;
}

// Use the built-in ErrorRateLimitStrategy for production
// This will throw errors on rate limits instead of waiting

// This will be set by the main function
let influencerList = [];
let sinceDate = dayjs().subtract(7, 'day').format('YYYY-MM-DD');

let totalInfluencerTweets = 0;
let totalMyReplies = 0;
let unrepliedTweets = [];

let myUsername = '';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getMyReplies(scraperManager) {
    // Calculate days from sinceDate for logging
    const sinceDateObj = dayjs(sinceDate);
    const daysDiff = dayjs().diff(sinceDateObj, 'day');
    console.log(`Getting your replies from the last ${daysDiff} days (since ${sinceDate})...`);
    
    let myReplies = [];
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
        try {
            console.log(`Attempt ${attempts + 1}/${maxAttempts} - Using scraper ${scraperManager.getCurrentAccountNumber()}`);
            
            // Record request in scraper manager
            scraperManager.requestCounts[scraperManager.currentIndex]++;
            scraperManager.lastRequestTimes[scraperManager.currentIndex] = Date.now();
            
            let replyCount = 0;
            const startTime = Date.now();
            
            // Create a timeout promise to prevent getting stuck
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('timeout')), 120000); // 2 minute timeout for replies
            });
            
            // Create the reply collection promise
            const replyCollectionPromise = (async () => {
                const collectedReplies = [];
            for await (const tweet of scraperManager.getCurrentScraper().searchTweets(`from:${myUsername} since:${sinceDate} filter:replies`, 1000, SearchMode.Latest)) {
                replyCount++;
                if (replyCount % 50 === 0) {
                    console.log(`  Found ${replyCount} replies...`);
                }
                    collectedReplies.push(tweet);
                
                    // Check if we've been stuck for too long
                if (replyCount % 10 === 0) {
                    const timeSinceStart = Date.now() - startTime;
                    if (timeSinceStart > 30000) {
                            console.log(`⚠ Request seems stuck, breaking...`);
                            break;
                        }
                    }
                }
                return collectedReplies;
            })();
            
            // Race between reply collection and timeout
            myReplies = await Promise.race([replyCollectionPromise, timeoutPromise]);
            
            console.log(`✓ Found ${myReplies.length} of your replies`);
            break; // Success, exit the while loop
            
        } catch (error) {
            if (error.message === 'timeout') {
                console.log(`⚠ Timeout reached for replies, switching scraper...`);
                // Record timeout in the scraper manager
                scraperManager.timeoutCounts[scraperManager.currentIndex]++;
                console.log(`Timeout recorded for scraper ${scraperManager.getCurrentAccountNumber()} (timeout #${scraperManager.timeoutCounts[scraperManager.currentIndex]})`);
                scraperManager.switchScraper();
                myReplies = []; // Reset replies array
            } else {
            console.error(`✗ Error on attempt ${attempts + 1}:`, error.message);
            }
            attempts++;
            
            if (attempts < maxAttempts) {
                console.log(`Switching scraper and retrying...`);
                scraperManager.switchScraper();
                await sleep(5000); // Wait 5 seconds before retry
            }
        }
    }
    
    return myReplies;
}

async function getInfluencerTweets(scraperManager) {
    console.log(`Getting tweets from ${influencerList.length} influencers...`);
    
    const validInfluencers = influencerList.filter(influencer => influencer.trim());
    const allInfluencerTweets = [];
    let totalInfluencerTweets = 0;
    let requestsSinceLastSwitch = 0;
    const SWITCH_EVERY_N_REQUESTS = 15; // Switch scrapers every 15 influencers (less aggressive)
    const GLOBAL_TIMEOUT = 300000; // 5 minutes global timeout
    const globalStartTime = Date.now();

    for (let i = 0; i < validInfluencers.length; i++) {
        await sleep(10000); 
        
        // Global timeout check - only log, don't switch aggressively
        if (Date.now() - globalStartTime > GLOBAL_TIMEOUT) {
            console.log(`⚠ Global timeout reached (${Math.round(GLOBAL_TIMEOUT/1000)}s), continuing with current scraper`);
        }
        
        const influencer = validInfluencers[i];
        console.log(`Processing ${influencer} (${i + 1}/${validInfluencers.length})...`);
        
        // Proactive scraper rotation to avoid rate limits
        if (requestsSinceLastSwitch >= SWITCH_EVERY_N_REQUESTS) {
            console.log(`🔄 Proactively switching scraper to avoid rate limits...`);
            scraperManager.switchScraper();
            requestsSinceLastSwitch = 0;
            await sleep(10000); // Wait 10 seconds after switching
        }
        
        const influencerStartTime = Date.now();
        let tweets = [];
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts && tweets.length === 0) {
            // Global timeout: skip this influencer if it's taking too long
            const timeElapsed = Date.now() - influencerStartTime;
            if (timeElapsed > 120000) { // 2 minutes
                console.log(`⚠ Skipping ${influencer} - taking too long (${Math.round(timeElapsed/1000)}s)`);
                break;
            }
            
            try {
                console.log(`  Attempt ${attempts + 1}/${maxAttempts} - Using scraper ${scraperManager.getCurrentAccountNumber()}`);
                
                scraperManager.requestCounts[scraperManager.currentIndex]++;
                scraperManager.lastRequestTimes[scraperManager.currentIndex] = Date.now();
                
                const startTime = Date.now();
                let lastTweetTime = Date.now();
                let tweetCount = 0;
                
                // Create a timeout promise to prevent getting stuck
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('timeout')), 60000); // 60 second timeout
                });
                
                // Create the tweet collection promise
                const tweetCollectionPromise = (async () => {
                    const collectedTweets = [];
                    for await (const tweet of scraperManager.getCurrentScraper().searchTweets(`from:${influencer} since:${sinceDate}`, 350, SearchMode.Latest)) {
                    tweetCount++;
                    lastTweetTime = Date.now();
                    
                    if (tweetCount % 50 === 0) {
                        console.log(`    Found ${tweetCount} tweets for ${influencer}...`);
                    }
                        collectedTweets.push(tweet);
                    
                        // Check if we've been stuck for too long
                    if (tweetCount % 5 === 0) {
                        const timeSinceLastTweet = Date.now() - lastTweetTime;
                        const totalTime = Date.now() - startTime;
                        
                        if (timeSinceLastTweet > 15000 || totalTime > 30000) {
                                console.log(`    ⚠ Request seems stuck (${Math.round(timeSinceLastTweet/1000)}s since last tweet), breaking...`);
                                break;
                            }
                        }
                    }
                    return collectedTweets;
                })();
                
                // Race between tweet collection and timeout
                tweets = await Promise.race([tweetCollectionPromise, timeoutPromise]);
                
                console.log(`✓ Found ${tweets.length} tweets for ${influencer}`);
                break; // Success, exit the while loop
                
            } catch (error) {
                if (error.message === 'timeout') {
                    console.log(`    ⚠ Timeout reached for ${influencer}, switching scraper...`);
                    // Record timeout in the scraper manager
                    scraperManager.timeoutCounts[scraperManager.currentIndex]++;
                    console.log(`    Timeout recorded for scraper ${scraperManager.getCurrentAccountNumber()} (timeout #${scraperManager.timeoutCounts[scraperManager.currentIndex]})`);
                    scraperManager.switchScraper();
                    requestsSinceLastSwitch = 0;
                    tweets = []; // Reset tweets array
                } else {
                console.error(`✗ Error on attempt ${attempts + 1} for ${influencer}:`, error.message);
                }
                attempts++;
                
                if (attempts < maxAttempts) {
                    console.log(`  Retrying with current scraper...`);
                    requestsSinceLastSwitch = 0;
                    await sleep(15000); // Wait 15 seconds before retry (longer delay)
                }
            }
        }
        
        // If we still have no tweets after all attempts, log it and continue
        if (tweets.length === 0) {
            console.log(`⚠ No tweets found for ${influencer} after ${maxAttempts} attempts`);
        }
        
        allInfluencerTweets.push({influencer, tweets});
        totalInfluencerTweets += tweets.length;
        requestsSinceLastSwitch++;
        
        // Progress update every 10 influencers
        if ((i + 1) % 10 === 0) {
            console.log(`\n--- Progress: ${i + 1}/${validInfluencers.length} influencers processed ---\n`);
            
            // Display session statistics
            const sessionStats = scraperManager.getSessionStats();
            console.log(`📊 Session Statistics:`);
            sessionStats.forEach(stat => {
                const performance = stat.timeouts > 0 ? `⚠️` : `✅`;
                console.log(`  ${performance} Scraper ${stat.scraper}: ${stat.sessionAge}s old, ${stat.requestCount} requests, ${stat.timeouts} timeouts, ${stat.avgResponseTime}s avg response, ${stat.timeSinceLastUse}s since last use`);
            });
            console.log('');
        }
        
        // Longer delay between influencers to avoid rate limits
        await sleep(5000); // 5 seconds between influencers
    }

    return allInfluencerTweets;
}

function findUnrepliedTweets(influencerTweets, myReplies) {
    console.log(`Analyzing influencer engagement...`);
    
    const replyMap = new Map();
    myReplies.forEach(reply => {
        if (reply.inReplyToStatusId) {
            replyMap.set(reply.inReplyToStatusId, {
                replyTime: reply.timestamp,
                replyId: reply.id,
                replyText: reply.text,
                replyMentions: reply.mentions ? reply.mentions.map(mention => mention.username) : []
            });
        }
    });
    
    console.log(`You replied to ${replyMap.size} unique tweets`);
    
    influencerTweets.forEach(({influencer, tweets}) => {
        let replies = 0;
        let totalReplyTime = 0;
        let allMentions = [];
        let unrepliedTweetsList = [];
        
        tweets.forEach(tweet => {
            const replyData = replyMap.get(tweet.id);
            if (replyData) {
                replies++;
                const replyTime = replyData.replyTime;
                const tweetTime = tweet.timestamp;
                const replyDelaySeconds = (replyTime - tweetTime); 
                totalReplyTime += replyDelaySeconds;
                
                // Collect mentions from replies
                if (replyData.replyMentions && replyData.replyMentions.length > 0) {
                    allMentions.push(...replyData.replyMentions);
                }
            } else {
                // This tweet was not replied to - add to unreplied list
                unrepliedTweetsList.push({
                    id: tweet.id,
                    text: tweet.text,
                    timestamp: tweet.timestamp,
                    timeParsed: tweet.timeParsed,
                    url: tweet.url,
                    likes: tweet.likes,
                    retweets: tweet.retweets,
                    replies: tweet.replies
                });
            }
        });
        
        const averageReplyTime = totalReplyTime / replies;
        const uniqueMentions = [...new Set(allMentions)];
        
        unrepliedTweets.push({
            influencer,
            total_tweets: tweets.length,
            replies: replies,
            unreplied_count: unrepliedTweetsList.length,
            average_reply_time_minutes: averageReplyTime / 60,
            average_reply_time_seconds: averageReplyTime,
            tweet_mentions: uniqueMentions,
            reply_rate: replies > 0 ? ((replies / tweets.length) * 100).toFixed(1) + '%' : '0%',
            unreplied_tweets: unrepliedTweetsList
        });
    });
}

async function main(username = null, influencers = null, days = 7, processId = null) {
    if (!username) {
        username = process.argv[2];
    }
    myUsername = username;
    if(!myUsername) {
        console.log('Please provide a username as an argument');
        process.exit(1);
    }
    
    // Generate process ID if not provided
    if (!processId) {
        processId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
    
    // Set influencers list
    if (influencers) {
        influencerList = influencers;
    } else {
        // Fallback to reading from file if no influencers provided
        try {
            influencerList = fs.readFileSync('influencers.txt', 'utf-8').split('\n');
        } catch (error) {
            console.log('No influencers file found and no influencers provided');
            process.exit(1);
        }
    }
    
    // Set since date based on days parameter
    sinceDate = dayjs().subtract(days, 'day').format('YYYY-MM-DD');
    
    console.log(`Analyzing ${myUsername} with ${influencerList.length} influencers for the last ${days} days (since ${sinceDate})...`);
    console.log(`Process ID: ${processId}`);
    
    const scraperManager = new ScraperManager(); // Let it auto-detect from .env
    await scraperManager.initialize();
    
    // Store all data in a comprehensive JSON structure
    const allData = {
        analysis_date: new Date().toISOString(),
        username: myUsername,
        since_date: sinceDate,
        my_replies: [],
        influencer_tweets: [],
        analysis_results: []
    };
    
    // Get your replies first
    console.log('\n=== STEP 1: Getting your replies ===');
    const myReplies = await getMyReplies(scraperManager);
    totalMyReplies = myReplies.length;
    allData.my_replies = myReplies;
    
    // Save intermediate results
    fs.writeFileSync(`data/tweets/${myUsername}_${processId}_my_replies.json`, JSON.stringify(myReplies, null, 2));
    console.log(`✓ Saved your replies to data/tweets/${myUsername}_${processId}_my_replies.json`);
    
    // Get influencer tweets
    console.log('\n=== STEP 2: Getting influencer tweets ===');
    const influencerTweets = await getInfluencerTweets(scraperManager);
    
    // Optimize data storage - store only essential tweet data
    const optimizedInfluencerTweets = influencerTweets.map(({influencer, tweets}) => ({
        influencer,
        tweet_count: tweets.length,
        tweets: tweets.map(tweet => ({
            id: tweet.id,
            text: tweet.text,
            timestamp: tweet.timestamp,
            timeParsed: tweet.timeParsed,
            url: tweet.url,
            likes: tweet.likes,
            retweets: tweet.retweets,
            replies: tweet.replies
        }))
    }));
    
    allData.influencer_tweets = optimizedInfluencerTweets;
    
    // Save intermediate results
    fs.writeFileSync(`data/tweets/${myUsername}_${processId}_influencer_tweets.json`, JSON.stringify(optimizedInfluencerTweets, null, 2));
    console.log(`✓ Saved influencer tweets to data/tweets/${myUsername}_${processId}_influencer_tweets.json`);
    
    // Run analysis
    console.log('\n=== STEP 3: Running analysis ===');
    findUnrepliedTweets(influencerTweets, myReplies);
    allData.analysis_results = unrepliedTweets;
    
    // Create CSV file
    const csvHeader = 'Influencer,Number of Tweets,Number of Replies,Unreplied Count,Average Reply Time (minutes),Tweet Mentions,Reply Rate\n';
    let csvContent = csvHeader;
    
    unrepliedTweets
        .sort((a, b) => b.replies - a.replies) // Sort by number of replies
        .forEach((item) => {
            const mentions = item.tweet_mentions && item.tweet_mentions.length > 0 ? 
                item.tweet_mentions.join('; ') : 'None';
            const avgReplyTime = item.replies > 0 ? 
                Math.round(item.average_reply_time_minutes) : 0;
            
            csvContent += `"${item.influencer}",${item.total_tweets},${item.replies},${item.unreplied_count},${avgReplyTime},"${mentions}",${item.reply_rate}\n`;
        });
    
    fs.writeFileSync(`data/csv/${myUsername}_${processId}_influencer_analysis.csv`, csvContent);
    
    // Create separate file for unreplied tweets
    const allUnrepliedTweets = [];
    unrepliedTweets.forEach(item => {
        item.unreplied_tweets.forEach(tweet => {
            allUnrepliedTweets.push({
                influencer: item.influencer,
                ...tweet
            });
        });
    });
    
    fs.writeFileSync(`data/tweets/${myUsername}_${processId}_unreplied_tweets.json`, JSON.stringify(allUnrepliedTweets, null, 2));
    
    // Save comprehensive JSON (optimized)
    const results = {
        summary: {
            total_influencer_tweets: totalInfluencerTweets,
            total_my_replies: totalMyReplies,
            total_replies_made: unrepliedTweets.reduce((sum, item) => sum + item.replies, 0),
            total_unreplied_tweets: unrepliedTweets.reduce((sum, item) => sum + item.unreplied_count, 0),
            influencers_analyzed: unrepliedTweets.length,
            analysis_date: new Date().toISOString(),
            process_id: processId
        },
        all_data: allData
    };
    
    fs.writeFileSync(`data/analysis/${myUsername}_${processId}_complete_analysis.json`, JSON.stringify(results, null, 2));
    
    console.log(`\n=== ANALYSIS COMPLETE ===`);
    console.log(`Total influencer tweets: ${totalInfluencerTweets}`);
    console.log(`Your replies: ${totalMyReplies}`);
    console.log(`Total unreplied tweets: ${results.summary.total_unreplied_tweets}`);
    console.log(`Influencers analyzed: ${unrepliedTweets.length}`);
    console.log(`\nFiles created:`);
    console.log(`- data/tweets/${myUsername}_${processId}_my_replies.json`);
    console.log(`- data/tweets/${myUsername}_${processId}_influencer_tweets.json`);
    console.log(`- data/csv/${myUsername}_${processId}_influencer_analysis.csv`);
    console.log(`- data/tweets/${myUsername}_${processId}_unreplied_tweets.json`);
    console.log(`- data/analysis/${myUsername}_${processId}_complete_analysis.json`);
    
    // Show top 5 influencers as preview
    console.log(`\n=== TOP 5 INFLUENCERS (PREVIEW) ===`);
    unrepliedTweets
        .sort((a, b) => b.replies - a.replies)
        .slice(0, 5)
        .forEach((item, index) => {
            console.log(`${index + 1}. ${item.influencer}: ${item.replies} replies, ${item.unreplied_count} unreplied (${item.reply_rate} rate)`);
        });

    
    console.log('\n=== SCRIPT COMPLETE ===');
    
    // Return results for API
    return {
        analysisFile: `${myUsername}_${processId}_complete_analysis.json`,
        unrepliedFile: `${myUsername}_${processId}_unreplied_tweets.json`,
        csvFile: `${myUsername}_${processId}_influencer_analysis.csv`,
        stats: results.summary
    };
}

// Export for API server
export { main };

// Only run if called directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
main(); 
} 