#!/bin/bash

# Setup SSL Certificate and nginx Configuration
# This script creates the SSL certificate and configures nginx for HTTPS

set -e

echo "🔒 Setting up SSL certificate and nginx configuration..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Get server IP
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "localhost")
print_status "Server IP detected: $SERVER_IP"

# Create SSL certificate directory if it doesn't exist
sudo mkdir -p /etc/ssl/private /etc/ssl/certs

# Generate self-signed SSL certificate
print_status "Generating self-signed SSL certificate..."
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/ssl/private/nginx-selfsigned.key \
    -out /etc/ssl/certs/nginx-selfsigned.crt \
    -subj "/C=US/ST=State/L=City/O=Organization/CN=$SERVER_IP"

print_success "SSL certificate generated"

# Copy nginx configuration
print_status "Setting up nginx configuration..."

# Check if nginx is installed and find the correct config directory
if [ -d "/etc/nginx/sites-available" ]; then
    # Standard Ubuntu/Debian nginx
    sudo cp nginx.conf /etc/nginx/sites-available/twitter-scraper
    sudo ln -sf /etc/nginx/sites-available/twitter-scraper /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
elif [ -d "/etc/nginx/conf.d" ]; then
    # CentOS/RHEL/Fedora nginx
    sudo cp nginx.conf /etc/nginx/conf.d/twitter-scraper.conf
else
    # Fallback - copy to main nginx.conf
    print_warning "Standard nginx directories not found. Copying to main nginx.conf"
    sudo cp nginx.conf /etc/nginx/nginx.conf
fi

# Test nginx configuration
print_status "Testing nginx configuration..."
sudo nginx -t

# Reload nginx
print_status "Reloading nginx..."
sudo systemctl reload nginx

print_success "SSL and nginx setup complete!"

echo ""
echo "=========================================="
echo "🔒 SSL Setup Complete!"
echo "=========================================="
echo ""
echo "Your app is now accessible via:"
echo "   HTTPS: https://$SERVER_IP"
echo "   HTTP:  http://$SERVER_IP (redirects to HTTPS)"
echo ""
echo "⚠️  Note: Your browser will show a security warning"
echo "   This is normal for self-signed certificates."
echo "   Click 'Advanced' → 'Proceed to [IP] (unsafe)'"
echo ""
echo "==========================================" 