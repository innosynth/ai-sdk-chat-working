// Define types for document processing

export interface ProcessedChunk {
  text: string;
  vector: number[];
}

export type FileType = 'txt' | 'pdf' | 'docx' | 'csv' | 'xlsx' | 'json';

export interface FileData {
  name: string;
  type: FileType;
  content: string | string[][] | ArrayBuffer; // Raw content for display/re-processing
  processed?: {
    originalContent: string;
    previewContent: string;
    chunks: ProcessedChunk[];
  };
  mimeType?: string;
}

export interface ProcessedDocument {
  originalContent: string;
  previewContent: string;
  chunks: ProcessedChunk[];
  fileName: string;
  fileType: string;
} 