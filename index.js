import express from 'express';
import multer from 'multer';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { main } from './find_unreplied_tweets.js';
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Configure multer for file uploads
const upload = multer({ 
    dest: 'uploads/',
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/plain') {
            cb(null, true);
        } else {
            cb(new Error('Only .txt files are allowed'));
        }
    }
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Store active scraping jobs
const activeJobs = new Map();

// Jobs storage file
const JOBS_FILE = 'data/jobs.json';

// Initialize all required directories
function initializeDirectories() {
  const directories = [
    'data',
    'data/cookies',
    'data/tweets', 
    'data/csv',
    'data/analysis',
    'data/uploads'
  ];
  
  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
      } catch (error) {
        console.error(`❌ Failed to create directory ${dir}:`, error.message);
      }
    }
  });
}

// Load jobs from file
function loadJobsFromFile() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const data = fs.readFileSync(JOBS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading jobs file:', error);
  }
  return [];
}

// Save jobs to file
function saveJobsToFile(jobs) {
  try {
    // Ensure data directory exists before saving
    if (!fs.existsSync('data')) {
      fs.mkdirSync('data', { recursive: true });
    }
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
  } catch (error) {
    console.error('Error saving jobs file:', error);
  }
}

// Generate unique process IDs
function generateProcessId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    activeJobs: activeJobs.size
  });
});

// Scrape endpoint
app.post('/scrape', upload.single('influencers'), async (req, res) => {
  try {
    // Ensure all directories exist before starting
    initializeDirectories();
    
    const { username, days } = req.body;
    const influencersFile = req.file;
    
    if (!username || !influencersFile) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['username', 'influencers file'],
        received: { username: !!username, file: !!influencersFile }
      });
    }
    
    const daysToAnalyze = parseInt(days) || 30;
    
    // Read influencers from file
    const influencersContent = fs.readFileSync(influencersFile.path, 'utf-8');
    const influencers = influencersContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .slice(0, 50); // Limit to 50 influencers
    
    if (influencers.length === 0) {
      return res.status(400).json({ 
        error: 'No valid influencers found in file',
        fileContent: influencersContent.substring(0, 200) + '...'
      });
    }
    
    // Generate unique job ID
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create job object
    const job = {
      id: jobId,
      username,
      influencers: influencers,
      daysToAnalyze,
      status: 'starting',
      timestamp: new Date().toISOString(),
      progress: {
        current: 0,
        total: influencers.length,
        currentInfluencer: '',
        phase: 'initializing'
      },
      stats: {
        totalTweets: 0,
        totalReplies: 0,
        totalUnreplied: 0,
        timeouts: 0,
        errors: 0
      },
      files: []
    };
    
    // Save job to file
    const jobs = loadJobsFromFile();
    jobs.push(job);
    saveJobsToFile(jobs);
    
    // Store in active jobs
    activeJobs.set(jobId, {
      ...job,
      abortController: new AbortController()
    });
    
    console.log(`🚀 Starting new scraping job: ${jobId}`);
    console.log(`👤 Username: ${username}`);
    console.log(`📊 Days to analyze: ${daysToAnalyze}`);
    console.log(`👥 Influencers: ${influencers.length}`);
    
    // Start scraping in background
    startScrapingJob(jobId, username, influencers, daysToAnalyze);
    
    res.json({
      message: 'Scraping job started successfully',
      jobId: jobId,
      job: job
    });
    
  } catch (error) {
    console.error('❌ Error starting scraping job:', error);
    res.status(500).json({ 
      error: 'Failed to start scraping job',
      details: error.message
    });
  }
});

// Status endpoint
app.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = Array.from(activeJobs.values()).find(j => j.id === jobId);
  
  if (!job) {
    return res.status(404).json({ 
      error: 'No active job found for this ID',
      jobId: jobId
    });
  }

  res.json(job);
});

// Results endpoint
app.get('/results/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = Array.from(activeJobs.values()).find(j => j.id === jobId);
  
  if (!job) {
    return res.status(404).json({ 
      error: 'No job found for this ID',
      jobId: jobId
    });
  }

  if (job.status === 'running') {
    return res.status(202).json({
      message: 'Job still running',
      status: 'running',
      progress: job.progress
    });
  }

  if (job.status === 'failed') {
    return res.status(500).json({
      error: 'Job failed',
      status: 'failed',
      error: job.error
    });
  }

  // Job completed successfully
  res.json({
    message: 'Job completed successfully',
    status: 'completed',
    results: job.results,
    files: {
      analysis: `/download/${job.results.analysisFile}`,
      unreplied: `/download/${job.results.unrepliedFile}`,
      csv: `/download/${job.results.csvFile}`
    }
  });
});

// Download endpoint - handle paths with slashes
app.get('/download/*', (req, res) => {
  const filename = req.params[0]; // Get the full path after /download/
  console.log(`🔍 Download request for: ${filename}`);
  
  // Handle the new directory structure
  let filePath;
  if (filename.includes('data/')) {
    // File is already in the correct path format
    filePath = path.join(__dirname, filename);
    console.log(`📁 Using direct path: ${filePath}`);
  } else {
    // New approach: determine directory based on file extension/name
    let searchDir = '';
    if (filename.endsWith('_complete_analysis.json')) {
      searchDir = 'data/analysis';
    } else if (filename.endsWith('_my_replies.json') || filename.endsWith('_influencer_tweets.json') || filename.endsWith('_unreplied_tweets.json')) {
      searchDir = 'data/tweets';
    } else if (filename.endsWith('_influencer_analysis.csv')) {
      searchDir = 'data/csv';
    } else if (filename.startsWith('cookies') && filename.endsWith('.json')) {
      searchDir = 'data/cookies';
    }
    
    if (searchDir) {
      filePath = path.join(__dirname, searchDir, filename);
      console.log(`📁 Searching in ${searchDir}: ${filePath}`);
    } else {
      // Legacy support - try to find file in organized directories
      const possiblePaths = [
        path.join(__dirname, 'data/analysis', filename),
        path.join(__dirname, 'data/tweets', filename),
        path.join(__dirname, 'data/csv', filename),
        path.join(__dirname, 'data/cookies', filename),
        path.join(__dirname, filename) // Fallback to root
      ];
      
      console.log(`🔍 Searching in paths:`, possiblePaths);
      filePath = possiblePaths.find(p => {
        try {
          return fs.existsSync(p);
        } catch (error) {
          console.error(`Error checking path ${p}:`, error.message);
          return false;
        }
      });
      
      if (!filePath) {
        console.log(`❌ File not found in any path`);
        return res.status(404).json({ 
          error: 'File not found',
          filename: filename,
          searchedPaths: possiblePaths
        });
      }
      console.log(`✅ Found file at: ${filePath}`);
    }
  }
  
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`❌ File does not exist at: ${filePath}`);
      return res.status(404).json({ 
        error: 'File not found',
        filename: filename,
        filePath: filePath
      });
    }

    console.log(`✅ Serving file: ${filePath}`);
    res.download(filePath);
  } catch (error) {
    console.error(`❌ Error serving file ${filePath}:`, error.message);
    res.status(500).json({ 
      error: 'Error serving file',
      filename: filename,
      details: error.message
    });
  }
});

// Get all jobs
app.get('/jobs', (req, res) => {
  try {
    const jobs = loadJobsFromFile();
    res.json({
      totalJobs: jobs.length,
      jobs: jobs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    });
  } catch (error) {
    console.error('Error loading jobs:', error);
    res.status(500).json({ 
      error: 'Failed to load jobs',
      details: error.message
    });
  }
});

// Delete a job
app.delete('/jobs/:id', (req, res) => {
  try {
    const jobId = req.params.id;
    const jobs = loadJobsFromFile();
    const jobIndex = jobs.findIndex(job => job.id === jobId);
    
    if (jobIndex === -1) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const deletedJob = jobs.splice(jobIndex, 1)[0];
    saveJobsToFile(jobs);
    
    // Also remove from active jobs if it's still running
    if (activeJobs.has(jobId)) {
      const job = activeJobs.get(jobId);
      if (job.abortController) {
        job.abortController.abort();
      }
      activeJobs.delete(jobId);
    }
    
    res.json({ 
      message: 'Job deleted successfully',
      deletedJob: deletedJob
    });
  } catch (error) {
    console.error('Error deleting job:', error);
    res.status(500).json({ 
      error: 'Failed to delete job',
      details: error.message
    });
  }
});

// List all results
app.get('/results', (req, res) => {
  const analysisDir = path.join(__dirname, 'data/analysis');
  let files = [];
  
  try {
    if (fs.existsSync(analysisDir)) {
      files = fs.readdirSync(analysisDir)
        .filter(file => file.endsWith('_complete_analysis.json'))
        .map(file => {
          // Parse username and process ID from filename
          // Format: username_processId_complete_analysis.json
          const parts = file.replace('_complete_analysis.json', '').split('_');
          const processId = parts.pop(); // Last part is process ID
          const username = parts.join('_'); // Everything else is username
          
          const filePath = path.join(analysisDir, file);
          const stats = fs.statSync(filePath);
          
          // Try to read the file to get process ID from metadata
          let processIdFromFile = processId;
          try {
            const fileContent = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            if (fileContent.summary && fileContent.summary.process_id) {
              processIdFromFile = fileContent.summary.process_id;
            }
          } catch (e) {
            // If we can't read the file, use the parsed process ID
          }
          
          return {
            username: username,
            processId: processIdFromFile,
            filename: `data/analysis/${file}`,
            size: stats.size,
            modified: stats.mtime.toISOString(),
            downloadUrl: `/download/data/analysis/${file}`
          };
        })
        .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    }
  } catch (error) {
    console.error('Error reading analysis directory:', error);
  }

  res.json({
    totalResults: files.length,
    results: files
  });
});

// Background scraping function
async function startScrapingJob(jobId, username, influencers, daysToAnalyze) {
  try {
    // Ensure all directories exist
    initializeDirectories();
    
    const job = activeJobs.get(jobId);
    if (!job) {
      console.error(`❌ Job ${jobId} not found in active jobs`);
      return;
    }
    
    // Update job status
    updateJobStatus(jobId, 'running', 'Starting scraper initialization...');
    
    // Initialize scraper manager
    const scraperManager = new ScraperManager();
    await scraperManager.initialize();
    
    console.log(`✅ Scraper manager initialized for job ${jobId}`);
    
    // Get my replies first
    updateJobProgress(jobId, 0, influencers.length, 'Getting your replies...', 'my_replies');
    
    const myReplies = await scraperManager.getMyReplies(username, daysToAnalyze);
    console.log(`📊 Found ${myReplies.length} of your replies`);
    
    // Update stats
    updateJobStats(jobId, { totalReplies: myReplies.length });
    
    // Save my replies
    const myRepliesFile = `data/tweets/${username}_my_replies.json`;
    fs.writeFileSync(myRepliesFile, JSON.stringify(myReplies, null, 2));
    addJobFile(jobId, myRepliesFile);
    
    // Process each influencer
    let totalTweets = 0;
    let totalUnreplied = 0;
    let timeouts = 0;
    let errors = 0;
    
    for (let i = 0; i < influencers.length; i++) {
      const influencer = influencers[i];
      
      // Check if job was aborted
      if (job.abortController?.signal.aborted) {
        console.log(`⏹️ Job ${jobId} was aborted`);
        updateJobStatus(jobId, 'aborted', 'Job was cancelled by user');
        return;
      }
      
      updateJobProgress(jobId, i, influencers.length, `Analyzing ${influencer}...`, 'influencer_tweets');
      
      try {
        console.log(`🔍 Processing influencer ${i + 1}/${influencers.length}: ${influencer}`);
        
        const influencerTweets = await scraperManager.getInfluencerTweets(influencer, daysToAnalyze);
        console.log(`📊 Found ${influencerTweets.length} tweets from ${influencer}`);
        
        totalTweets += influencerTweets.length;
        
        // Find unreplied tweets
        const unrepliedTweets = findUnrepliedTweets(influencerTweets, myReplies);
        console.log(`❌ Found ${unrepliedTweets.length} unreplied tweets from ${influencer}`);
        
        totalUnreplied += unrepliedTweets.length;
        
        // Save influencer tweets
        const influencerTweetsFile = `data/tweets/${influencer}_tweets.json`;
        fs.writeFileSync(influencerTweetsFile, JSON.stringify(influencerTweets, null, 2));
        addJobFile(jobId, influencerTweetsFile);
        
        // Save unreplied tweets
        const unrepliedTweetsFile = `data/tweets/${influencer}_unreplied_tweets.json`;
        fs.writeFileSync(unrepliedTweetsFile, JSON.stringify(unrepliedTweets, null, 2));
        addJobFile(jobId, unrepliedTweetsFile);
        
        // Update stats
        updateJobStats(jobId, { 
          totalTweets: totalTweets,
          totalUnreplied: totalUnreplied
        });
        
      } catch (error) {
        console.error(`❌ Error processing ${influencer}:`, error.message);
        errors++;
        updateJobStats(jobId, { errors: errors });
        
        if (error.message.includes('timeout') || error.message.includes('rate limit')) {
          timeouts++;
          updateJobStats(jobId, { timeouts: timeouts });
        }
      }
    }
    
    // Generate analysis
    updateJobProgress(jobId, influencers.length, influencers.length, 'Generating analysis...', 'analysis');
    
    const analysis = generateAnalysis(username, influencers, myReplies, totalTweets, totalUnreplied, timeouts, errors);
    
    // Save analysis
    const analysisFile = `data/analysis/${username}_complete_analysis.json`;
    fs.writeFileSync(analysisFile, JSON.stringify(analysis, null, 2));
    addJobFile(jobId, analysisFile);
    
    // Generate CSV
    const csvFile = `data/csv/${username}_influencer_analysis.csv`;
    generateCSV(analysis, csvFile);
    addJobFile(jobId, csvFile);
    
    // Update final status
    updateJobStatus(jobId, 'completed', `Analysis complete! Found ${totalUnreplied} unreplied tweets out of ${totalTweets} total tweets.`);
    
    console.log(`✅ Job ${jobId} completed successfully`);
    console.log(`📊 Final stats: ${totalTweets} tweets, ${totalUnreplied} unreplied, ${timeouts} timeouts, ${errors} errors`);
    
  } catch (error) {
    console.error(`❌ Error in job ${jobId}:`, error);
    updateJobStatus(jobId, 'error', `Job failed: ${error.message}`);
  } finally {
    // Clean up
    if (activeJobs.has(jobId)) {
      const job = activeJobs.get(jobId);
      if (job.abortController) {
        job.abortController = null;
      }
    }
  }
}

// Serve the main HTML interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('joinJob', (jobId) => {
    socket.join(jobId);
    console.log(`Client ${socket.id} joined job ${jobId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Start server
server.listen(PORT, () => {
  // Initialize directories on startup
  initializeDirectories();
  
  console.log(`🚀 Twitter Scraper API server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🌐 Web interface: http://localhost:${PORT}`);
});

function generateCSV(analysis, filename) {
  try {
    // Ensure csv directory exists
    const csvDir = path.dirname(filename);
    if (!fs.existsSync(csvDir)) {
      fs.mkdirSync(csvDir, { recursive: true });
    }
    
    const csvContent = [
      'Influencer,Total Tweets,Unreplied Tweets,Reply Rate,Last Tweet Date,Engagement Level',
      ...analysis.influencers.map(inf => 
        `"${inf.username}","${inf.totalTweets}","${inf.unrepliedTweets}","${inf.replyRate}%","${inf.lastTweetDate}","${inf.engagementLevel}"`
      )
    ].join('\n');
    
    fs.writeFileSync(filename, csvContent);
    console.log(`📊 CSV saved: ${filename}`);
  } catch (error) {
    console.error(`❌ Error generating CSV ${filename}:`, error.message);
  }
}

// Helper functions for job management
function updateJobStatus(jobId, status, message) {
  try {
    const job = activeJobs.get(jobId);
    if (job) {
      job.status = status;
      job.message = message;
      
      // Update in file
      const jobs = loadJobsFromFile();
      const jobIndex = jobs.findIndex(j => j.id === jobId);
      if (jobIndex !== -1) {
        jobs[jobIndex].status = status;
        jobs[jobIndex].message = message;
        saveJobsToFile(jobs);
      }
      
      // Emit to client
      io.to(jobId).emit('statusUpdate', { status, message });
    }
  } catch (error) {
    console.error(`Error updating job status for ${jobId}:`, error.message);
  }
}

function updateJobProgress(jobId, current, total, message, phase) {
  try {
    const job = activeJobs.get(jobId);
    if (job) {
      job.progress = {
        current,
        total,
        currentInfluencer: message,
        phase
      };
      
      // Update in file
      const jobs = loadJobsFromFile();
      const jobIndex = jobs.findIndex(j => j.id === jobId);
      if (jobIndex !== -1) {
        jobs[jobIndex].progress = job.progress;
        saveJobsToFile(jobs);
      }
      
      // Emit to client
      io.to(jobId).emit('progressUpdate', job.progress);
      io.to(jobId).emit('log', { message, timestamp: new Date().toISOString() });
    }
  } catch (error) {
    console.error(`Error updating job progress for ${jobId}:`, error.message);
  }
}

function updateJobStats(jobId, stats) {
  try {
    const job = activeJobs.get(jobId);
    if (job) {
      job.stats = { ...job.stats, ...stats };
      
      // Update in file
      const jobs = loadJobsFromFile();
      const jobIndex = jobs.findIndex(j => j.id === jobId);
      if (jobIndex !== -1) {
        jobs[jobIndex].stats = job.stats;
        saveJobsToFile(jobs);
      }
      
      // Emit to client
      io.to(jobId).emit('statsUpdate', job.stats);
    }
  } catch (error) {
    console.error(`Error updating job stats for ${jobId}:`, error.message);
  }
}

function addJobFile(jobId, filepath) {
  try {
    const job = activeJobs.get(jobId);
    if (job) {
      if (!job.files) job.files = [];
      job.files.push(filepath);
      
      // Update in file
      const jobs = loadJobsFromFile();
      const jobIndex = jobs.findIndex(j => j.id === jobId);
      if (jobIndex !== -1) {
        if (!jobs[jobIndex].files) jobs[jobIndex].files = [];
        jobs[jobIndex].files.push(filepath);
        saveJobsToFile(jobs);
      }
      
      // Emit to client
      io.to(jobId).emit('fileAdded', { filepath });
    }
  } catch (error) {
    console.error(`Error adding file to job ${jobId}:`, error.message);
  }
}