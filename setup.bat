@echo off
REM Setup script for Windows
REM Run this before starting the container

echo Setting up data directories...

REM Create data directory if it doesn't exist
if not exist "data" mkdir data
if not exist "logs" mkdir logs

echo Directory setup complete!
echo You can now run: docker-compose up -d