const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');

const API_BASE_URL = 'http://localhost:5005';
const TEST_FILE_PATH = path.join(__dirname, 'test-sample.txt');

// Colors for console output
const colors = {
  info: '\x1b[36m',   // Cyan
  success: '\x1b[32m', // Green
  error: '\x1b[31m',   // Red
  reset: '\x1b[0m'     // Reset
};

// Log with colors
function log(message, type = 'info') {
  const color = colors[type] || colors.info;
  console.log(`${color}${message}${colors.reset}`);
}

// Create a test file if it doesn't exist
async function createTestFile() {
  const content = `This is a test file for the server.
It contains multiple lines to test chunking.
The server should be able to process this file.
It should extract text content and create vector embeddings.
This is line 5 of the test file.
This is line 6 of the test file.
This is line 7 of the test file.
This is line 8 of the test file.
This is line 9 of the test file.
This is the last line of the test file.`;

  try {
    fs.writeFileSync(TEST_FILE_PATH, content);
    log(`Test file created at ${TEST_FILE_PATH}`, 'success');
    return true;
  } catch (error) {
    log(`Error creating test file: ${error.message}`, 'error');
    return false;
  }
}

// Test health endpoint
async function testHealth() {
  try {
    log('Testing server health...');
    const response = await fetch(`${API_BASE_URL}/health`);
    
    if (response.ok) {
      const data = await response.json();
      log(`Server health check: ${JSON.stringify(data)}`, 'success');
      return true;
    } else {
      log(`Server returned error: ${response.status} ${response.statusText}`, 'error');
      return false;
    }
  } catch (error) {
    log(`Error connecting to server: ${error.message}`, 'error');
    log('Make sure the Python server is running (npm run dev)', 'error');
    return false;
  }
}

// Test file processing
async function testFileProcessing() {
  try {
    log('Testing file processing...');
    
    // Create form data with the test file
    const formData = new FormData();
    formData.append('file', fs.createReadStream(TEST_FILE_PATH));
    formData.append('fileName', 'test-sample.txt');
    formData.append('fileType', 'txt');
    
    const response = await fetch(`${API_BASE_URL}/process`, {
      method: 'POST',
      body: formData,
    });
    
    if (response.ok) {
      const data = await response.json();
      log(`File processed successfully!`, 'success');
      log(`Chunks created: ${data.chunks.length}`, 'success');
      log(`First chunk text: "${data.chunks[0].text.substring(0, 50)}..."`, 'info');
      log(`Vector dimensions: ${data.chunks[0].vector.length}`, 'info');
      return true;
    } else {
      const errorText = await response.text();
      log(`Server returned error: ${response.status} ${response.statusText}`, 'error');
      log(`Error details: ${errorText}`, 'error');
      return false;
    }
  } catch (error) {
    log(`Error processing file: ${error.message}`, 'error');
    return false;
  }
}

// Test vector creation
async function testVectorCreation() {
  try {
    log('Testing vector creation...');
    
    const response = await fetch(`${API_BASE_URL}/vectorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'This is a test query.' }),
    });
    
    if (response.ok) {
      const data = await response.json();
      log(`Vector created successfully!`, 'success');
      log(`Input text: "${data.text}"`, 'info');
      log(`Vector dimensions: ${data.vector.length}`, 'info');
      return true;
    } else {
      const errorText = await response.text();
      log(`Server returned error: ${response.status} ${response.statusText}`, 'error');
      log(`Error details: ${errorText}`, 'error');
      return false;
    }
  } catch (error) {
    log(`Error creating vector: ${error.message}`, 'error');
    return false;
  }
}

// Test similarity search
async function testSimilaritySearch() {
  try {
    log('Testing similarity search...');
    
    // First get some vectors from a file
    const formData = new FormData();
    formData.append('file', fs.createReadStream(TEST_FILE_PATH));
    formData.append('fileName', 'test-sample.txt');
    formData.append('fileType', 'txt');
    
    const processResponse = await fetch(`${API_BASE_URL}/process`, {
      method: 'POST',
      body: formData,
    });
    
    if (!processResponse.ok) {
      log(`Failed to process file for similarity search test`, 'error');
      return false;
    }
    
    const processData = await processResponse.json();
    const chunks = processData.chunks;
    
    // Now perform similarity search
    const searchResponse = await fetch(`${API_BASE_URL}/find_relevant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'What is in line 5?',
        chunks: chunks,
        threshold: 0.5,
        maxChunks: 3,
      }),
    });
    
    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      log(`Similarity search completed successfully!`, 'success');
      log(`Query: "${searchData.query}"`, 'info');
      log(`Relevant chunks found: ${searchData.count}`, 'info');
      if (searchData.count > 0) {
        log(`First relevant chunk: "${searchData.relevantChunks[0].text.substring(0, 50)}..."`, 'info');
      }
      return true;
    } else {
      const errorText = await searchResponse.text();
      log(`Server returned error: ${searchResponse.status} ${searchResponse.statusText}`, 'error');
      log(`Error details: ${errorText}`, 'error');
      return false;
    }
  } catch (error) {
    log(`Error in similarity search: ${error.message}`, 'error');
    return false;
  }
}

// Run all tests
async function runTests() {
  log('=== Python Server Test Suite ===\n');
  
  // Create test file
  const fileCreated = await createTestFile();
  if (!fileCreated) {
    log('Failed to create test file. Aborting tests.', 'error');
    return;
  }
  
  // Test server health
  const healthStatus = await testHealth();
  if (!healthStatus) {
    log('Health check failed. Aborting remaining tests.', 'error');
    return;
  }
  
  // Test file processing
  const processingStatus = await testFileProcessing();
  if (!processingStatus) {
    log('File processing test failed. Continuing with remaining tests.', 'error');
  }
  
  // Test vector creation
  const vectorStatus = await testVectorCreation();
  if (!vectorStatus) {
    log('Vector creation test failed. Continuing with remaining tests.', 'error');
  }
  
  // Test similarity search
  const similarityStatus = await testSimilaritySearch();
  if (!similarityStatus) {
    log('Similarity search test failed.', 'error');
  }
  
  // Final results
  log('\n=== Test Results ===');
  log(`Health Check: ${healthStatus ? 'PASSED' : 'FAILED'}`, healthStatus ? 'success' : 'error');
  log(`File Processing: ${processingStatus ? 'PASSED' : 'FAILED'}`, processingStatus ? 'success' : 'error');
  log(`Vector Creation: ${vectorStatus ? 'PASSED' : 'FAILED'}`, vectorStatus ? 'success' : 'error');
  log(`Similarity Search: ${similarityStatus ? 'PASSED' : 'FAILED'}`, similarityStatus ? 'success' : 'error');
  
  const allPassed = healthStatus && processingStatus && vectorStatus && similarityStatus;
  log(`\nOverall Result: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`, allPassed ? 'success' : 'error');
}

// Run the tests
runTests(); 