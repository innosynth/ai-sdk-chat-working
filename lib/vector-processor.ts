import * as use from '@tensorflow-models/universal-sentence-encoder';
// Remove node-fetch import, rely on global fetch
// import fetch from 'node-fetch';
import * as pdfjsLib from 'pdfjs-dist'; // Import main library
import mammoth from 'mammoth';

// Set worker path for pdfjs-dist using the imported version
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// TGI server configuration
const TGI_SERVER_URL = 'https://dq2jqf0v-8080.inc1.devtunnels.ms/v1/chat/completions';

// Initialize Universal Sentence Encoder
let encoder: any = null;
const loadEncoder = async () => {
  if (!encoder) {
    // Load the model directly from tfhub.dev
    encoder = await use.load();
  }
  return encoder;
};

// Process text into vectors
export const processTextToVector = async (text: string): Promise<number[]> => {
  const loadedEncoder = await loadEncoder();
  const embeddings = await loadedEncoder.embed([text]); // Pass text as an array
  const embeddingArray = await embeddings.array(); // Convert tensor to array
  embeddings.dispose(); // Dispose the tensor to free memory
  return embeddingArray[0]; // Return the first (and only) embedding
};

// Helper function to extract text from PDF using pdfjs-dist
async function extractTextFromPDF(buffer: ArrayBuffer): Promise<string> {
  try {
    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    const pdf = await loadingTask.promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      // Ensure item.str exists before joining
      fullText += textContent.items.map((item: any) => item.str || '').join(' ');
      page.cleanup(); // Cleanup page resources
    }
    return fullText;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    return 'Error processing PDF';
  }
}

// Helper function to extract text from DOCX using mammoth
async function extractTextFromDOCX(buffer: ArrayBuffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value; // The raw text
  } catch (error) {
    console.error('Error extracting text from DOCX:', error);
    return 'Error processing DOCX';
  }
}

// Process document content based on type
export const processDocument = async (fileData: {
  name: string;
  type: string;
  content: string | string[][] | ArrayBuffer;
  mimeType?: string;
}): Promise<{ originalContent: string; chunks: { text: string; vector: number[] }[] }> => {
  let originalContent = '';
  let textToProcess = '';
  const chunks: { text: string; vector: number[] }[] = [];
  const MAX_CHUNKS = 50; // Limit the number of chunks to process
  const CHUNK_SIZE = 500; // Characters per chunk

  try {
    switch (fileData.type) {
      case 'csv':
      case 'xlsx':
        const data = fileData.content as string[][];
        originalContent = data.map(row => row.join(', ')).join('\n');
        if (data.length > 0) {
          const headers = data[0].join(', ');
          textToProcess = `Headers: ${headers}\n\nData:\n${data.slice(1).map(row => row.join(', ')).join('\n')}`;
        }
        break;

      case 'txt':
        originalContent = fileData.content as string;
        textToProcess = originalContent;
        break;

      case 'pdf':
        originalContent = `PDF Content for: ${fileData.name}`; // Placeholder
        textToProcess = await extractTextFromPDF(fileData.content as ArrayBuffer);
        originalContent = textToProcess; // Update original content after extraction
        break;

      case 'docx':
        originalContent = `DOCX Content for: ${fileData.name}`; // Placeholder
        textToProcess = await extractTextFromDOCX(fileData.content as ArrayBuffer);
        originalContent = textToProcess; // Update original content after extraction
        break;

      default:
         // Use mimeType for better detection if available
         const fileTypeDesc = fileData.mimeType || fileData.type.toUpperCase();
         originalContent = `File: ${fileData.name}\nType: ${fileTypeDesc}`;
         textToProcess = `Unsupported file type: ${fileTypeDesc}`;
         console.warn(`Unsupported file type encountered: ${fileTypeDesc} for file ${fileData.name}`);
    }

    // Chunk the text content
    for (let i = 0; i < textToProcess.length; i += CHUNK_SIZE) {
      if (chunks.length >= MAX_CHUNKS) {
          console.warn(`Reached max chunks (${MAX_CHUNKS}) for file ${fileData.name}. Truncating content.`);
          break; // Stop if max chunks reached
      }
      const textChunk = textToProcess.slice(i, i + CHUNK_SIZE);
      if (textChunk.trim()) { // Only process non-empty chunks
          try {
              const vector = await processTextToVector(textChunk);
              chunks.push({ text: textChunk, vector });
          } catch (vectorError) {
              console.error(`Error vectorizing chunk for ${fileData.name}:`, vectorError);
              // Optionally push a chunk indicating error or skip
          }
      }
    }

    // If no chunks were created (e.g., empty file or error), create a placeholder chunk
     if (chunks.length === 0 && textToProcess.trim()) {
         console.log(`Creating single chunk for seemingly non-empty file: ${fileData.name}`);
       const vector = await processTextToVector(textToProcess.slice(0, CHUNK_SIZE));
       chunks.push({ text: textToProcess.slice(0, CHUNK_SIZE), vector });
     } else if (chunks.length === 0) {
         console.log(`Creating fallback chunk for empty/unprocessed file: ${fileData.name}`);
         const fallbackText = `Content summary for ${fileData.name}`;
         const vector = await processTextToVector(fallbackText);
         chunks.push({ text: fallbackText, vector });
     }

    console.log(`Processed ${fileData.name} into ${chunks.length} chunks.`);
    return { originalContent, chunks };

  } catch (error: any) {
    console.error(`Error processing document ${fileData.name}:`, error);
     const fallbackText = `Error processing file ${fileData.name}`;
     // Attempt to vectorize the error message itself as a fallback chunk
     try {
        const vector = await processTextToVector(fallbackText);
        return { originalContent: fallbackText, chunks: [{ text: fallbackText, vector }] };
     } catch (vectorError) {
         console.error(`Failed to vectorize fallback error message for ${fileData.name}:`, vectorError);
         // Final fallback with a default vector if even error vectorization fails
         return { originalContent: fallbackText, chunks: [{ text: fallbackText, vector: [] }] }; // Or provide a zero vector of correct dimension if known
     }
  }
};


// Generate chat response using TGI server and context from processed documents
export const generateChatResponse = async (
  userMessage: string,
  relevantChunks: { text: string; vector: number[] }[], // Expecting processed chunks
  streamCallback?: (chunk: string) => void
): Promise<string> => {
  try {
    // Construct context from relevant chunks
    const context = relevantChunks.map(chunk => chunk.text).join("\n\n");

    const messages = [];

    // Add context as part of the user message if provided
    const fullUserMessage = context
      ? `Context from uploaded documents:\n---\n${context}\n---\n\nUser Question: ${userMessage}` // Added separators for clarity
      : userMessage;

    messages.push({
      role: "user",
      content: fullUserMessage
    });

    const shouldStream = !!streamCallback;

    // Use global fetch
    const response = await fetch(TGI_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "tgi", // Assuming your TGI model ID
        messages: messages,
        max_tokens: 1500, // Increased token limit for context
        stream: shouldStream,
        temperature: 0.7, // Example: Add TGI parameter
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('TGI Server Error:', `${response.status} ${response.statusText}`, errorText);
      throw new Error(`TGI request failed: ${response.status}. ${errorText}`);
    }

    // Handle streaming response
    if (shouldStream && streamCallback) {
       let fullContent = '';
       if (!response.body) {
         throw new Error('Response body is null');
       }
       // Browser fetch response.body is already a ReadableStream
       const reader = response.body.getReader();
       const decoder = new TextDecoder();

       try {
           while (true) {
             const { done, value } = await reader.read();
             if (done) break;
             const chunk = decoder.decode(value, { stream: true });

             // Process Server-Sent Events (SSE)
             const lines = chunk.split('\n');
             for (const line of lines) {
               if (line.startsWith('data: ')) {
                 const dataContent = line.substring(6).trim();
                 if (dataContent === '[DONE]') continue; // TGI stream end signal

                 try {
                   const jsonData = JSON.parse(dataContent);
                   if (jsonData.choices && jsonData.choices.length > 0) {
                     // TGI might send delta or full message content depending on stream setup
                     const contentChunk = jsonData.choices[0].delta?.content || jsonData.choices[0].message?.content || '';
                     if (contentChunk) {
                       fullContent += contentChunk;
                       streamCallback(contentChunk);
                     }
                   }
                 } catch (parseError) {
                   console.error('Error parsing SSE data line:', dataContent, parseError);
                   // Handle cases where a line might not be valid JSON (e.g., incomplete stream)
                   // Avoid calling streamCallback here unless you want to show raw/error data
                 }
               }
             }
           }
       } finally {
           reader.releaseLock(); // Ensure the lock is always released
       }
       return fullContent;
     }
    // Handle non-streaming response
    else {
      const data = await response.json();
      if (data.choices && data.choices.length > 0 && data.choices[0].message) {
        return data.choices[0].message.content;
      } else {
           console.error("Unexpected TGI non-streaming response format:", data);
        throw new Error('Invalid non-streaming response format from TGI server');
      }
    }
  } catch (error) {
    console.error('Error generating chat response:', error);
     // Provide a user-friendly error message
     const errorMessage = `Error generating response: ${error instanceof Error ? error.message : String(error)}`;
     if (streamCallback) {
         streamCallback(`\n\n--- ${errorMessage} ---`);
     }
    // Return the error message string so the UI can display it
     return errorMessage;
  }
};


// Calculate cosine similarity between vectors
export const cosineSimilarity = (vec1: number[], vec2: number[]): number => {
  if (!vec1 || !vec2 || vec1.length === 0 || vec2.length === 0 || vec1.length !== vec2.length) {
      // console.warn("Invalid vectors for cosine similarity - Length mismatch or empty vector(s).");
    return 0;
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  let allZero1 = true;
  let allZero2 = true;

  for (let i = 0; i < vec1.length; i++) {
      const v1 = vec1[i];
      const v2 = vec2[i];
      if (v1 !== 0) allZero1 = false;
      if (v2 !== 0) allZero2 = false;
      dotProduct += v1 * v2;
      norm1 += v1 * v1;
      norm2 += v2 * v2;
  }

  // Check for zero vectors after calculating norms
  if (allZero1 || allZero2) {
    // console.warn("Cosine similarity with zero vector.");
    return 0;
  }

    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);

  if (norm1 === 0 || norm2 === 0) {
      // This check might be redundant due to allZero checks, but safe to keep
      // console.warn("Zero norm encountered in cosine similarity.");
      return 0; // Avoid division by zero
  }

  const similarity = dotProduct / (norm1 * norm2);
  // Clamp similarity to [-1, 1] to handle potential floating point inaccuracies
  return Math.max(-1, Math.min(1, similarity));
}; 