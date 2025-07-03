// Production configuration for Twitter scraper
module.exports = {
  // Scraper settings
  scraper: {
    maxRetries: 3,
    requestTimeout: 30000, // 30 seconds
    rateLimitStrategy: 'custom', // Use custom rate limit strategy
    maxConcurrentRequests: 2, // Limit concurrent requests
  },
  
  // Session management
  session: {
    sessionTimeout: 1800000, // 30 minutes
    requestsBeforeRefresh: 30, // Refresh after 30 requests (more conservative)
    maxSessionAge: 3600000, // 1 hour max session age
  },
  
  // Circuit breaker settings
  circuitBreaker: {
    maxConsecutiveErrors: 3, // Trip circuit breaker after 3 errors
    timeout: 300000, // 5 minutes circuit breaker timeout
    halfOpenMaxRequests: 1, // Allow only 1 request in half-open state
  },
  
  // Rate limiting
  rateLimit: {
    requestsPerMinute: 30, // Conservative rate limit
    burstSize: 5, // Allow small bursts
    cooldownPeriod: 60000, // 1 minute cooldown
  },
  
  // Error handling
  errorHandling: {
    exponentialBackoff: true,
    maxBackoffTime: 30000, // 30 seconds max backoff
    jitter: true, // Add randomness to backoff
  },
  
  // Monitoring
  monitoring: {
    enableMetrics: true,
    logLevel: 'info',
    healthCheckInterval: 30000, // 30 seconds
    performanceThresholds: {
      maxResponseTime: 30000, // 30 seconds
      maxTimeoutRate: 0.2, // 20% timeout rate
      maxErrorRate: 0.1, // 10% error rate
    }
  },
  
  // File management
  files: {
    maxFileSize: 50 * 1024 * 1024, // 50MB max file size
    cleanupInterval: 3600000, // 1 hour cleanup interval
    maxFilesPerJob: 10, // Max 10 files per job
  },
  
  // Security
  security: {
    validateInputs: true,
    sanitizeFilenames: true,
    maxInfluencersPerRequest: 200, // Limit influencers per request
    allowedFileTypes: ['.txt'],
  }
}; 