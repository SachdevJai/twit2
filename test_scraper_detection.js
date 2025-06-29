const { ScraperManager } = require('./find_unreplied_tweets.js');

async function testScraperDetection() {
    console.log('Testing scraper detection from .env file...\n');
    
    try {
        const scraperManager = new ScraperManager();
        await scraperManager.initialize();
        
        console.log('\n✅ Scraper detection test completed successfully!');
        console.log(`Found and initialized ${scraperManager.scrapers.length} scrapers`);
        
        // Show session stats
        const stats = scraperManager.getSessionStats();
        console.log('\n📊 Initial Session Statistics:');
        stats.forEach(stat => {
            console.log(`  Scraper ${stat.scraper}: ${stat.sessionAge}s old, ${stat.requestCount} requests`);
        });
        
    } catch (error) {
        console.error('❌ Scraper detection test failed:', error.message);
        console.log('\n💡 Make sure your .env file contains valid credentials:');
        console.log('   TWT_USERNAME1=your_username');
        console.log('   TWT_PASSWORD1=your_password');
        console.log('   TWT_EMAIL1=your_email');
        console.log('\n   (Repeat for TWT_USERNAME2, TWT_USERNAME3, etc.)');
    }
}

testScraperDetection(); 