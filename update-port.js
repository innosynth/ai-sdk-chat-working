const fs = require('fs');
const path = require('path');

// Function to update the API_BASE_URL in python-api.ts
function updateApiBaseUrl(port) {
  const apiFilePath = path.join(__dirname, 'lib', 'python-api.ts');
  
  if (!fs.existsSync(apiFilePath)) {
    console.error(`Error: Could not find ${apiFilePath}`);
    return false;
  }
  
  let content = fs.readFileSync(apiFilePath, 'utf8');
  
  // Replace the API_BASE_URL with the new port
  const newContent = content.replace(
    /const API_BASE_URL = ['"]http:\/\/localhost:\d+['"]/,
    `const API_BASE_URL = 'http://localhost:${port}'`
  );
  
  if (content === newContent) {
    console.log('No changes needed to API_BASE_URL');
    return false;
  }
  
  // Write the updated content back to the file
  fs.writeFileSync(apiFilePath, newContent);
  console.log(`Updated API_BASE_URL to use port ${port} in ${apiFilePath}`);
  return true;
}

// Get the port from command line arguments
const port = process.argv[2];

if (!port) {
  console.error('Please provide a port number as an argument');
  process.exit(1);
}

// Update the API_BASE_URL
if (updateApiBaseUrl(port)) {
  console.log('Successfully updated API_BASE_URL');
} else {
  console.log('No changes were made to API_BASE_URL');
} 