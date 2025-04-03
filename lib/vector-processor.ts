import { GoogleGenerativeAI } from '@google/generative-ai';
import * as use from '@tensorflow-models/universal-sentence-encoder';

// Initialize Gemini API
const genAI = new GoogleGenerativeAI('AIzaSyDKZz8Ckn_o-Pe4LRZBzmJcfGEVaZEWnJ8');
const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

// Initialize Universal Sentence Encoder
let encoder: any = null;
const loadEncoder = async () => {
  if (!encoder) {
    encoder = await use.load();
  }
  return encoder;
};

// Process text into vectors
export const processTextToVector = async (text: string): Promise<number[]> => {
  const loadedEncoder = await loadEncoder();
  const embeddings = await loadedEncoder.embed(text);
  return Array.from(embeddings);
};

// Process document content based on type
export const processDocument = async (fileData: {
  name: string;
  type: string;
  content: string | string[][] | ArrayBuffer;
  mimeType?: string;
}): Promise<string> => {
  let processedContent = '';

  switch (fileData.type) {
    case 'csv':
    case 'xlsx':
      // Convert spreadsheet data to text
      const data = fileData.content as string[][];
      processedContent = data.map(row => row.join(', ')).join('\n');
      break;

    case 'txt':
      processedContent = fileData.content as string;
      break;

    case 'pdf':
    case 'doc':
    case 'docx':
      // For binary documents, we'll just use the filename
      processedContent = `Document: ${fileData.name}`;
      break;

    default:
      processedContent = `File: ${fileData.name}`;
  }

  return processedContent;
};

// Generate chat response using Gemini API
export const generateChatResponse = async (
  userMessage: string,
  context?: string
): Promise<string> => {
  try {
    const prompt = context 
      ? `Context: ${context}\n\nUser: ${userMessage}`
      : userMessage;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Error generating chat response:', error);
    throw error;
  }
};

// Calculate cosine similarity between vectors
export const cosineSimilarity = (vec1: number[], vec2: number[]): number => {
  // Handle zero vectors
  if (vec1.every(val => val === 0) || vec2.every(val => val === 0)) {
    return 0;
  }

  const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
  const norm1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
  const norm2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (norm1 * norm2);
}; 