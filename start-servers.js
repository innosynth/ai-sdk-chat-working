const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Colors for console output
const colors = {
  nextjs: '\x1b[36m', // Cyan
  python: '\x1b[32m', // Green
  error: '\x1b[31m',  // Red
  success: '\x1b[32m', // Green
  reset: '\x1b[0m'    // Reset
};

// Log with timestamp and server name
function log(serverName, message, isError = false) {
  const timestamp = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
  const color = isError ? colors.error : (serverName === 'NextJS' ? colors.nextjs : colors.python);
  console.log(`${color}[${timestamp}] [${serverName}] ${message}${colors.reset}`);
}

// Function to update the API_BASE_URL in python-api.ts
function updateApiBaseUrl(port) {
  const apiFilePath = path.join(__dirname, 'lib', 'python-api.ts');
  
  if (!fs.existsSync(apiFilePath)) {
    log('Config', `Error: Could not find ${apiFilePath}`, true);
    return false;
  }
  
  let content = fs.readFileSync(apiFilePath, 'utf8');
  
  // Replace the API_BASE_URL with the new port
  const newContent = content.replace(
    /const API_BASE_URL = ['"]http:\/\/localhost:\d+['"]/,
    `const API_BASE_URL = 'http://localhost:${port}'`
  );
  
  if (content === newContent) {
    log('Config', 'No changes needed to API_BASE_URL');
    return false;
  }
  
  // Write the updated content back to the file
  fs.writeFileSync(apiFilePath, newContent);
  log('Config', `Updated API_BASE_URL to use port ${port}`, false);
  return true;
}

// Check Python version and availability
function checkPythonCommand() {
  return new Promise((resolve) => {
    log('Python', 'Checking Python version...');
    // Try to get Python version using python3 command
    const python3Process = spawn('python3', ['--version'], { shell: true });
    
    python3Process.on('error', () => {
      log('Python', 'python3 command not found, will try python command', true);
      // Try with python command instead
      const pythonProcess = spawn('python', ['--version'], { shell: true });
      
      pythonProcess.on('error', () => {
        log('Python', 'Neither python3 nor python commands are available', true);
        resolve(null);
      });
      
      pythonProcess.on('close', (code) => {
        if (code === 0) {
          log('Python', 'Using python command');
          resolve('python');
        } else {
          log('Python', 'Python not found', true);
          resolve(null);
        }
      });
    });
    
    python3Process.on('close', (code) => {
      if (code === 0) {
        log('Python', 'Using python3 command');
        resolve('python3');
      } else {
        // Try with python command instead
        const pythonProcess = spawn('python', ['--version'], { shell: true });
        
        pythonProcess.on('error', () => {
          log('Python', 'Python not found', true);
          resolve(null);
        });
        
        pythonProcess.on('close', (code) => {
          if (code === 0) {
            log('Python', 'Using python command');
            resolve('python');
          } else {
            log('Python', 'Python not found', true);
            resolve(null);
          }
        });
      }
    });
  });
}

// Create or update virtual environment based on requirements.txt
async function setupVirtualEnvironment(pythonCmd) {
  // Check if venv directory exists
  if (!fs.existsSync(path.join(__dirname, 'venv'))) {
    log('Python', 'Creating virtual environment...');
    
    const createVenvProcess = spawn(pythonCmd, ['-m', 'venv', 'venv'], { shell: true });
    
    await new Promise((resolve, reject) => {
      createVenvProcess.on('close', (code) => {
        if (code === 0) {
          log('Python', 'Virtual environment created successfully');
          resolve();
        } else {
          log('Python', 'Failed to create virtual environment', true);
          reject(new Error('Failed to create virtual environment'));
        }
      });
    });
  } else {
    log('Python', 'Virtual environment already exists');
  }
  
  // Install dependencies
  log('Python', 'Installing dependencies...');
  
  const pipPath = process.platform === 'win32' ? 'venv\\Scripts\\pip' : 'venv/bin/pip';
  const installProcess = spawn(pipPath, ['install', '-r', 'requirements.txt'], { shell: true });
  
  installProcess.stdout.on('data', (data) => {
    log('Python', data.toString().trim());
  });
  
  installProcess.stderr.on('data', (data) => {
    // Don't treat all stderr as errors since pip uses it for progress
    log('Python', data.toString().trim());
  });
  
  return new Promise((resolve, reject) => {
    installProcess.on('close', (code) => {
      if (code === 0) {
        log('Python', 'Dependencies installed successfully');
        resolve();
      } else {
        log('Python', 'Failed to install dependencies', true);
        reject(new Error('Failed to install dependencies'));
      }
    });
  });
}

// Start the Next.js server
function startNextJSServer() {
  log('NextJS', 'Starting Next.js development server...');
  
  const nextServer = spawn('npm', ['run', 'dev:next'], { shell: true });
  
  nextServer.stdout.on('data', (data) => {
    const output = data.toString().trim();
    log('NextJS', output);
  });
  
  nextServer.stderr.on('data', (data) => {
    log('NextJS', data.toString().trim(), true);
  });
  
  nextServer.on('close', (code) => {
    log('NextJS', `Server exited with code ${code}`, code !== 0);
    
    if (code !== 0 && code !== null) {
      // Restart server
      log('NextJS', 'Restarting Next.js server...');
      startNextJSServer();
    }
  });
  
  return nextServer;
}

// Start the Python server
function startPythonServer() {
  log('Python', 'Starting Python server...');
  
  const pythonScript = 'server.py';
  const pythonExecutable = process.platform === 'win32' ? 'venv\\Scripts\\python' : 'venv/bin/python';
  
  const pythonServer = spawn(pythonExecutable, [pythonScript], { 
    shell: true,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1'  // Ensure Python output is not buffered
    }
  });
  
  // Keep track of the server's port
  let serverPort = null;
  const portRegex = /Starting server on [^:]+:(\d+)/;
  
  pythonServer.stdout.on('data', (data) => {
    const output = data.toString().trim();
    log('Python', output);
    
    // Check if output contains server port info
    const match = output.match(portRegex);
    if (match && match[1]) {
      serverPort = match[1];
      // Update the API_BASE_URL if the port was detected
      updateApiBaseUrl(serverPort);
    }
  });
  
  pythonServer.stderr.on('data', (data) => {
    log('Python', data.toString().trim(), true);
  });
  
  pythonServer.on('close', (code) => {
    log('Python', `Server exited with code ${code}`, code !== 0);
    
    if (code !== 0 && code !== null) {
      // Restart server
      log('Python', 'Restarting Python server...');
      startPythonServer();
    }
  });
  
  return pythonServer;
}

// Main function
async function main() {
  try {
    // First, check if Python is available
    const pythonCmd = await checkPythonCommand();
    if (!pythonCmd) {
      throw new Error('Python is required to run the server.');
    }
    
    // Then, set up the virtual environment
    await setupVirtualEnvironment(pythonCmd);
    
    // Start the servers
    const pythonServer = startPythonServer();
    const nextServer = startNextJSServer();
    
    // Handle process termination
    process.on('SIGINT', () => {
      log('Main', 'Received SIGINT. Shutting down servers...');
      pythonServer.kill();
      nextServer.kill();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      log('Main', 'Received SIGTERM. Shutting down servers...');
      pythonServer.kill();
      nextServer.kill();
      process.exit(0);
    });
    
    log('Main', 'All servers started successfully!', false);
    log('Main', 'Press Ctrl+C to stop all servers.', false);
  } catch (error) {
    log('Main', `Error: ${error.message}`, true);
    process.exit(1);
  }
}

// Start the servers
main(); 