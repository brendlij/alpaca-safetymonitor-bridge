#!/bin/bash

# Setup script for proper directory permissions
# Run this before starting the container

echo "Setting up data directories..."

# Create data directory if it doesn't exist
mkdir -p ./data
mkdir -p ./logs

# Set proper permissions (readable/writable for the current user)
chmod 755 ./data
chmod 755 ./logs

# If you're on Linux/Mac, also set the correct user ownership
if [[ "$OSTYPE" == "linux-gnu"* ]] || [[ "$OSTYPE" == "darwin"* ]]; then
    # Get the node user ID from the image (usually 1000)
    NODE_UID=1000
    NODE_GID=1000
    
    echo "Setting ownership to UID:GID $NODE_UID:$NODE_GID"
    sudo chown -R $NODE_UID:$NODE_GID ./data ./logs
fi

echo "Directory setup complete!"
echo "You can now run: docker-compose up -d"