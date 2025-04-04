#!/bin/bash

# Colors for better readability
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting chat interface application...${NC}"

# Kill any existing Python server processes
echo -e "${YELLOW}Checking for existing Python server processes...${NC}"
pkill -f "python.*server.py" 2>/dev/null || echo -e "${GREEN}No Python server processes running.${NC}"

# Check if port 5002 is in use
if lsof -i :5002 >/dev/null 2>&1; then
    echo -e "${RED}Port 5002 is already in use. Killing the process...${NC}"
    lsof -i :5002 | awk 'NR>1 {print $2}' | xargs kill -9
    echo -e "${GREEN}Process killed.${NC}"
fi

# Activate virtual environment and start Python server
echo -e "${YELLOW}Starting Python server on port 5002...${NC}"
cd "$(dirname "$0")"
if [ -d "venv" ]; then
    # Start Python server in background
    if [ "$(uname)" == "Darwin" ] || [ "$(uname)" == "Linux" ]; then
        # macOS or Linux
        venv/bin/python server.py &
    else
        # Windows
        venv\\Scripts\\python server.py &
    fi
    PYTHON_PID=$!
    echo -e "${GREEN}Python server started with PID ${PYTHON_PID}.${NC}"
else
    echo -e "${RED}Virtual environment not found. Please run 'python -m venv venv' and 'pip install -r requirements.txt' first.${NC}"
    exit 1
fi

# Start Next.js frontend
echo -e "${YELLOW}Starting Next.js frontend...${NC}"
npm run dev:next &
NEXTJS_PID=$!
echo -e "${GREEN}Next.js frontend started with PID ${NEXTJS_PID}.${NC}"

echo -e "${GREEN}All services started. Open http://localhost:3000 in your browser.${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop all services.${NC}"

# Handle termination
function cleanup {
    echo -e "${YELLOW}Shutting down services...${NC}"
    kill $PYTHON_PID $NEXTJS_PID 2>/dev/null
    echo -e "${GREEN}Services stopped.${NC}"
    exit 0
}

trap cleanup INT TERM

# Wait for processes to complete
wait 