import express from 'express';
import multer from 'multer';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { main } from './find_unreplied_tweets.js';
import fs from 'fs';
import path from 'path';
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

// Initialize required directories and files
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
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✅ Created directory: ${dir}`);
      }
  });
  
  // Initialize jobs file if it doesn't exist
  if (!fs.existsSync(JOBS_FILE)) {
    saveJobsToFile([]);
    console.log(`✅ Initialized jobs file: ${JOBS_FILE}`);
  }
}

// Initialize on startup
initializeDirectories();

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

// Scrape endpoint with file upload
app.post('/scrape', upload.single('influencersFile'), async (req, res) => {
  const { username, daysBack } = req.body;
  const influencersFile = req.file;

  if (!username) {
    return res.status(400).json({ 
      error: 'Username is required'
    });
  }

  if (!influencersFile) {
    return res.status(400).json({ 
      error: 'Influencers file is required'
    });
  }

  // Validate days parameter
  const days = parseInt(daysBack) || 7;
  if (days < 1 || days > 365) {
    return res.status(400).json({ 
      error: 'Days must be between 1 and 365'
    });
  }

  // Validate file content
  let influencers = [];
  try {
    const fileContent = fs.readFileSync(influencersFile.path, 'utf-8');
    influencers = fileContent.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    if (influencers.length === 0) {
      return res.status(400).json({ 
        error: 'Influencers file is empty or contains no valid usernames'
      });
    }
    
    console.log(`Validated ${influencers.length} influencers from uploaded file`);
  } catch (error) {
    return res.status(400).json({ 
      error: 'Failed to read influencers file: ' + error.message
    });
  }

  // Check if job is already running for this username
  if (activeJobs.has(username)) {
    return res.status(409).json({ 
      error: 'Scraping job already in progress for this username',
      username: username
    });
  }

  // Create job ID
  const jobId = `${username}_${Date.now()}`;
  const processId = generateProcessId(); // Generate unique process ID
  const jobStatus = {
    id: jobId,
    username: username,
    processId: processId, // Store process ID
    status: 'running',
    startTime: new Date().toISOString(),
    progress: 'Initializing...',
    results: null,
    error: null,
    influencersFile: influencersFile.path,
    influencers: influencers.length,
    daysBack: days
  };

  activeJobs.set(username, jobStatus);
    
  console.log(`🚀 Starting scrape job for ${username} (ID: ${jobId})`);

  // Start scraping in background
  scrapeInBackground(username, jobId, days, processId);

  // Return job info immediately
  res.json({
    message: 'Scraping job started',
    jobId: jobId,
    username: username,
    processId: processId,
    status: 'running',
    checkStatus: `/status/${jobId}`,
    results: `/results/${jobId}`
  });
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
      filePath = possiblePaths.find(p => fs.existsSync(p));
      
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
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

// Delete a job
app.delete('/jobs/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const jobs = loadJobsFromFile();
    const jobIndex = jobs.findIndex(job => job.id === jobId);
    
    if (jobIndex === -1) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const deletedJob = jobs.splice(jobIndex, 1)[0];
    saveJobsToFile(jobs);
    
    res.json({ 
      message: 'Job deleted successfully',
      deletedJob: deletedJob
    });
  } catch (error) {
    console.error('Error deleting job:', error);
    res.status(500).json({ error: 'Failed to delete job' });
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
async function scrapeInBackground(username, jobId, days, processId) {
  const job = Array.from(activeJobs.values()).find(j => j.id === jobId);
  
  try {
    // Update progress
    job.progress = 'Setting up scrapers...';
    io.to(jobId).emit('log', { message: 'Setting up scrapers...', timestamp: new Date().toISOString() });
    
    // Read influencers from uploaded file
    const influencersContent = fs.readFileSync(job.influencersFile, 'utf-8');
    const influencers = influencersContent.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    job.progress = `Found ${influencers.length} influencers to analyze`;
    io.to(jobId).emit('log', { message: `Found ${influencers.length} influencers to analyze`, timestamp: new Date().toISOString() });
    
    // Temporarily set argv[2] for the main function
    const originalArgv = process.argv;
    process.argv[2] = username;
    
    // Create a custom logger for real-time updates
    const originalConsoleLog = console.log;
    console.log = function(...args) {
      const message = args.join(' ');
      io.to(jobId).emit('log', { message, timestamp: new Date().toISOString() });
      originalConsoleLog.apply(console, args);
    };
    
    // Run the main scraping function with influencers and days
    const results = await main(username, influencers, days, processId);
    
    // Restore original console.log
    console.log = originalConsoleLog;
    
    // Restore original argv
    process.argv = originalArgv;
    
    // Update job status
    job.status = 'completed';
    job.progress = 'Completed successfully';
    job.results = results;
    job.endTime = new Date().toISOString();
    job.duration = new Date(job.endTime) - new Date(job.startTime);
    
    io.to(jobId).emit('jobComplete', { results });
    console.log(`✅ Scrape job completed for ${username} (ID: ${jobId})`);
    
    // Immediately remove completed job from activeJobs
    activeJobs.delete(username);
    
  } catch (error) {
    console.error(`❌ Scrape job failed for ${username} (ID: ${jobId}):`, error.message);
    
    // Update job status
    job.status = 'failed';
    job.progress = 'Failed';
    job.error = error.message;
    job.endTime = new Date().toISOString();
    job.duration = new Date(job.endTime) - new Date(job.startTime);
    
    io.to(jobId).emit('jobFailed', { error: error.message });
    
    // Immediately remove failed job from activeJobs
    activeJobs.delete(username);
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
  console.log(`🚀 Twitter Scraper API server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🌐 Web interface: http://localhost:${PORT}`);
});