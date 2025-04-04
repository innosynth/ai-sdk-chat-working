import { ProcessedChunk } from '@/types/document';

const API_BASE_URL = 'http://localhost:5002';

/**
 * Process a file using the Python backend
 */
export async function processFile(file: File): Promise<{
  originalContent: string;
  previewContent: string;
  chunks: ProcessedChunk[];
  fileName: string;
  fileType: string;
}> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('fileName', file.name);
    
    // Extract file type from extension
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    formData.append('fileType', fileExtension || 'unknown');
    
    const response = await fetch(`${API_BASE_URL}/process`, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Server responded with ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error processing file:', error);
    throw error;
  }
}

/**
 * Vectorize a text query using the Python backend
 */
export async function vectorizeText(text: string): Promise<{
  text: string;
  vector: number[];
}> {
  try {
    const response = await fetch(`${API_BASE_URL}/vectorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Server responded with ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error vectorizing text:', error);
    throw error;
  }
}

/**
 * Find relevant chunks based on a query
 */
export async function findRelevantChunks(
  query: string,
  chunks: ProcessedChunk[],
  threshold: number = 0.7,
  maxChunks: number = 5
): Promise<{
  query: string;
  relevantChunks: ProcessedChunk[];
  count: number;
}> {
  try {
    console.log(`Sending request to ${API_BASE_URL}/find_relevant with:`, {
      query,
      chunksCount: chunks.length,
      threshold,
      maxChunks
    });
    
    const response = await fetch(`${API_BASE_URL}/find_relevant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        chunks,
        threshold,
        maxChunks,
      }),
    });
    
    if (!response.ok) {
      let errorData = { error: `Server responded with ${response.status}` };
      try {
        errorData = await response.json();
      } catch (parseError) {
        console.error('Error parsing server error response:', parseError);
      }
      throw new Error(errorData.error || `Server responded with ${response.status}`);
    }
    
    const result = await response.json();
    console.log('Find relevant chunks response:', {
      query: result.query,
      count: result.count,
      relevantChunksPreview: result.relevantChunks?.slice(0, 2)
    });
    
    return result;
  } catch (error) {
    console.error('Error finding relevant chunks:', error);
    throw error;
  }
}

/**
 * Check if the Python server is running
 */
export async function checkPythonServer(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, { 
      method: 'GET',
      // Set a short timeout so we don't wait too long
      signal: AbortSignal.timeout(2000)
    });
    return response.ok;
  } catch (error) {
    console.error('Python server health check failed:', error);
    return false;
  }
} 