#!/bin/bash
echo "Checking for processes using port 5002..."

# Find the process ID using port 5002
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS command
  pid=$(lsof -ti:5002)
else
  # Linux command
  pid=$(netstat -tulpn 2>/dev/null | grep :5002 | awk '{print $7}' | cut -d'/' -f1)
fi

# Kill the process if found
if [ -n "$pid" ]; then
  echo "Found process $pid using port 5002. Killing it..."
  kill -9 $pid
  echo "Process killed."
else
  echo "No process found using port 5002."
fi

echo "Done." 