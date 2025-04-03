import { processTextToVector, processDocument, cosineSimilarity } from './vector-processor';

// Mock the Universal Sentence Encoder
jest.mock('@tensorflow-models/universal-sentence-encoder', () => ({
  load: jest.fn().mockResolvedValue({
    embed: jest.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]))
  })
}));

describe('Vector Processor', () => {
  describe('processTextToVector', () => {
    it('should convert text to vector', async () => {
      const text = 'Hello, world!';
      const vector = await processTextToVector(text);
      
      expect(vector).toBeDefined();
      expect(Array.isArray(vector)).toBe(true);
      expect(vector.length).toBeGreaterThan(0);
      expect(vector.every(val => typeof val === 'number')).toBe(true);
    }, 10000);

    it('should handle empty text', async () => {
      const text = '';
      const vector = await processTextToVector(text);
      
      expect(vector).toBeDefined();
      expect(Array.isArray(vector)).toBe(true);
      expect(vector.length).toBeGreaterThan(0);
    }, 10000);
  });

  describe('processDocument', () => {
    it('should process CSV data', async () => {
      const csvData = {
        name: 'test.csv',
        type: 'csv',
        content: [['header1', 'header2'], ['value1', 'value2']]
      };

      const result = await processDocument(csvData);
      expect(result).toBe('header1, header2\nvalue1, value2');
    });

    it('should process text file', async () => {
      const textData = {
        name: 'test.txt',
        type: 'txt',
        content: 'Hello, world!'
      };

      const result = await processDocument(textData);
      expect(result).toBe('Hello, world!');
    });

    it('should handle binary documents', async () => {
      const pdfData = {
        name: 'test.pdf',
        type: 'pdf',
        content: new ArrayBuffer(0)
      };

      const result = await processDocument(pdfData);
      expect(result).toBe('Document: test.pdf');
    });
  });

  describe('cosineSimilarity', () => {
    it('should calculate similarity between identical vectors', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [1, 0, 0];
      const similarity = cosineSimilarity(vec1, vec2);
      expect(similarity).toBe(1);
    });

    it('should calculate similarity between orthogonal vectors', () => {
      const vec1 = [1, 0];
      const vec2 = [0, 1];
      const similarity = cosineSimilarity(vec1, vec2);
      expect(similarity).toBe(0);
    });

    it('should handle zero vectors', () => {
      const vec1 = [0, 0];
      const vec2 = [0, 0];
      const similarity = cosineSimilarity(vec1, vec2);
      expect(similarity).toBe(0);
    });
  });
}); 