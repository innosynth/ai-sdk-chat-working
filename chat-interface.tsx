"use client"

import "ios-vibrator-pro-max"

import React from "react"
import { useState, useRef, useEffect, useCallback } from "react"
import {
  Lightbulb,
  ArrowUp,
  Menu,
  RefreshCw,
  Copy,
  Share2,
  ThumbsUp,
  ThumbsDown,
  Moon,
  Sun,
  FileSpreadsheet,
  FileText,
  File,
  Paperclip,
  X
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useTheme } from "@/hooks/use-theme"
import { useToast } from "@/hooks/use-toast"
import * as XLSX from "xlsx"
import Papa from "papaparse"
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import { 
  processFile, 
  vectorizeText, 
  findRelevantChunks,
  checkPythonServer
} from '@/lib/python-api';
import { ProcessedChunk, FileType } from '@/types/document';

type ActiveButton = "none" | "think"
type MessageType = "user" | "system" | "file"

interface FileData {
  name: string
  type: FileType
  content: string | string[][] | ArrayBuffer
  processed?: {
    originalContent: string
    chunks: ProcessedChunk[]
  }
  mimeType?: string
}

interface Message {
  id: string
  content: string
  type: MessageType
  completed?: boolean
  newSection?: boolean
  fileData?: FileData
}

interface MessageSection {
  id: string
  messages: Message[]
  isNewSection: boolean
  isActive?: boolean
  sectionIndex: number
}

interface StreamingWord {
  id: number
  text: string
}

// Configuration
const WORD_DELAY = 40 // ms per word
const CHUNK_SIZE = 2 // Number of words to add at once
const SIMILARITY_THRESHOLD = 0.7 // Threshold for selecting relevant chunks
const MAX_CONTEXT_CHUNKS = 5 // Max number of chunks to send as context

export default function ChatInterface() {
  const [inputValue, setInputValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const newSectionRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [hasTyped, setHasTyped] = useState(false)
  const [activeButton, setActiveButton] = useState<ActiveButton>("none")
  const [isMobile, setIsMobile] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [messageSections, setMessageSections] = useState<MessageSection[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingWords, setStreamingWords] = useState<StreamingWord[]>([])
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [viewportHeight, setViewportHeight] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [completedMessages, setCompletedMessages] = useState<Set<string>>(new Set())
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)
  const shouldFocusAfterStreamingRef = useRef(false)
  const mainContainerRef = useRef<HTMLDivElement>(null)
  // Store selection state
  const selectionStateRef = useRef<{ start: number | null; end: number | null }>({ start: null, end: null })
  const { theme, toggleTheme } = useTheme()
  const { toast } = useToast()
  // Store processed file data globally for context
  const [allProcessedChunks, setAllProcessedChunks] = useState<ProcessedChunk[]>([])
  const lastCompletedMessageRef = useRef<HTMLDivElement>(null)
  // Python server status
  const [isPythonServerAvailable, setIsPythonServerAvailable] = useState<boolean>(false)

  // Constants for layout calculations to account for the padding values
  const HEADER_HEIGHT = 48 // 12px height + padding
  const INPUT_AREA_HEIGHT = 100 // Approximate height of input area with padding
  const TOP_PADDING = 48 // pt-12 (3rem = 48px)
  const BOTTOM_PADDING = 128 // pb-32 (8rem = 128px)
  const ADDITIONAL_OFFSET = 16 // Reduced offset for fine-tuning

  // Check Python server on mount
  useEffect(() => {
    const checkServer = async () => {
      const isAvailable = await checkPythonServer();
      setIsPythonServerAvailable(isAvailable);
      
      if (!isAvailable) {
        toast({
          title: "Python Server Unavailable",
          description: "File processing will be limited. Please start the Python server with 'npm run dev'.",
          variant: "destructive",
          duration: 5000,
        });
      }
    };
    
    checkServer();
  }, [toast]);

  // Check if device is mobile and get viewport height
  useEffect(() => {
    const checkMobileAndViewport = () => {
      const isMobileDevice = window.innerWidth < 768
      setIsMobile(isMobileDevice)

      // Capture the viewport height
      const vh = window.innerHeight
      setViewportHeight(vh)

      // Apply fixed height to main container on mobile
      if (isMobileDevice && mainContainerRef.current) {
        mainContainerRef.current.style.height = `${vh}px`
      }
    }

    checkMobileAndViewport()

    // Set initial height
    if (mainContainerRef.current) {
      mainContainerRef.current.style.height = isMobile ? `${viewportHeight}px` : "100svh"
    }

    // Update on resize
    window.addEventListener("resize", checkMobileAndViewport)

    return () => {
      window.removeEventListener("resize", checkMobileAndViewport)
    }
  }, [isMobile, viewportHeight])

  // Initialize highlight.js
  useEffect(() => {
    hljs.configure({
      languages: ['javascript', 'typescript', 'python', 'jsx', 'tsx', 'html', 'css', 'json', 'bash'],
      ignoreUnescapedHTML: true
    });
  }, []);

  // Organize messages into sections
  useEffect(() => {
    if (messages.length === 0) {
      setMessageSections([])
      setActiveSectionId(null)
      return
    }

    const sections: MessageSection[] = []
    let currentSection: MessageSection = {
      id: `section-${Date.now()}-0`,
      messages: [],
      isNewSection: false,
      sectionIndex: 0,
    }

    messages.forEach((message) => {
      if (message.newSection) {
        // Start a new section
        if (currentSection.messages.length > 0) {
          // Mark previous section as inactive
          sections.push({
            ...currentSection,
            isActive: false,
          })
        }

        // Create new active section
        const newSectionId = `section-${Date.now()}-${sections.length}`
        currentSection = {
          id: newSectionId,
          messages: [message],
          isNewSection: true,
          isActive: true,
          sectionIndex: sections.length,
        }

        // Update active section ID
        setActiveSectionId(newSectionId)
      } else {
        // Add to current section
        currentSection.messages.push(message)
      }
    })

    // Add the last section if it has messages
    if (currentSection.messages.length > 0) {
      sections.push(currentSection)
    }

    setMessageSections(sections)
  }, [messages])

  // Scroll to maximum position when new section is created, but only for sections after the first
  useEffect(() => {
    if (messageSections.length > 1) {
      setTimeout(() => {
        const scrollContainer = chatContainerRef.current

        if (scrollContainer) {
          // Scroll to maximum possible position
          scrollContainer.scrollTo({
            top: scrollContainer.scrollHeight,
            behavior: "smooth",
          })
        }
      }, 100)
    }
  }, [messageSections])

  // Focus the textarea on component mount (only on desktop)
  useEffect(() => {
    if (textareaRef.current && !isMobile) {
      textareaRef.current.focus()
    }
  }, [isMobile])

  // Set focus back to textarea after streaming ends (only on desktop)
  useEffect(() => {
    if (!isStreaming && shouldFocusAfterStreamingRef.current && !isMobile) {
      focusTextarea()
      shouldFocusAfterStreamingRef.current = false
    }
  }, [isStreaming, isMobile])

  // Calculate available content height (viewport minus header and input)
  const getContentHeight = () => {
    // Calculate available height by subtracting the top and bottom padding from viewport height
    return viewportHeight - TOP_PADDING - BOTTOM_PADDING - ADDITIONAL_OFFSET
  }

  // Save the current selection state
  const saveSelectionState = () => {
    if (textareaRef.current) {
      selectionStateRef.current = {
        start: textareaRef.current.selectionStart,
        end: textareaRef.current.selectionEnd,
      }
    }
  }

  // Restore the saved selection state
  const restoreSelectionState = () => {
    const textarea = textareaRef.current
    const { start, end } = selectionStateRef.current

    if (textarea && start !== null && end !== null) {
      // Focus first, then set selection range
      textarea.focus()
      textarea.setSelectionRange(start, end)
    } else if (textarea) {
      // If no selection was saved, just focus
      textarea.focus()
    }
  }

  const focusTextarea = () => {
    if (textareaRef.current && !isMobile) {
      textareaRef.current.focus()
    }
  }

  const handleInputContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only focus if clicking directly on the container, not on buttons or other interactive elements
    if (
      e.target === e.currentTarget ||
      (e.currentTarget === inputContainerRef.current && !(e.target as HTMLElement).closest("button"))
    ) {
      if (textareaRef.current) {
        textareaRef.current.focus()
      }
    }
  }

  // Function to find relevant chunks based on user query
  const findRelevantChunksLocal = useCallback(async (query: string): Promise<ProcessedChunk[]> => {
    console.log("findRelevantChunksLocal called with query:", query);
    console.log("Current allProcessedChunks:", allProcessedChunks.length, "chunks available");
    
    if (allProcessedChunks.length === 0) {
      console.log("No processed chunks available");
      return [];
    }

    try {
      // If Python server is available, use it
      if (isPythonServerAvailable) {
        console.log("Using Python server to find relevant chunks");
        try {
          const result = await findRelevantChunks(query, allProcessedChunks, SIMILARITY_THRESHOLD, MAX_CONTEXT_CHUNKS);
          console.log("Python server returned relevant chunks:", result.relevantChunks.length);
          
          // If we got relevant chunks, return them
          if (result.relevantChunks && result.relevantChunks.length > 0) {
            return result.relevantChunks;
          } else {
            // If no relevant chunks from the server despite having documents, use recent chunks as fallback
            console.log("No relevant chunks returned by server, using fallback method");
          }
        } catch (pythonServerError) {
          console.error("Error from Python server:", pythonServerError);
          console.log("Using fallback chunk retrieval method");
        }
      } 
      
      // Fallback method - use the most recent chunks
      console.log("Using fallback method to find relevant chunks");
      
      // Sort chunks by order of addition (simplification: just use the last MAX_CONTEXT_CHUNKS)
      const recentChunks = [...allProcessedChunks].slice(-MAX_CONTEXT_CHUNKS);
      
      console.log(`Fallback: Using ${recentChunks.length} most recent chunks`);
      return recentChunks;
    } catch (error) {
      console.error("Error finding relevant chunks:", error);
      // Return a few recent chunks as last resort
      return allProcessedChunks.slice(-3);
    }
  }, [allProcessedChunks, isPythonServerAvailable]);

  // Add a function to ensure feedback buttons are visible
  const scrollToEnsureFeedbackButtonsVisible = () => {
    // Extra padding to ensure the buttons are fully visible
    const EXTRA_PADDING = 200; // Increased to 200px for better visibility

    setTimeout(() => {
      if (lastCompletedMessageRef.current && chatContainerRef.current && inputContainerRef.current) {
        const feedbackButtonsRect = lastCompletedMessageRef.current.getBoundingClientRect();
        const inputContainerRect = inputContainerRef.current.getBoundingClientRect();

        if (inputContainerRect && feedbackButtonsRect.bottom > inputContainerRect.top) {
          // Calculate how much additional scrolling is needed
          const additionalScroll = feedbackButtonsRect.bottom - inputContainerRect.top + EXTRA_PADDING;

          // Use smooth scrolling for better user experience
          chatContainerRef.current.scrollBy({
            top: additionalScroll,
            behavior: 'smooth'
          });
        }
      }
    }, 500); // Increased delay to ensure DOM is fully updated
  }

  const handleAIResponse = async (userMessage: string) => {
    // Create a new message with empty content
    const messageId = Date.now().toString()
    setStreamingMessageId(messageId)

    // Find relevant context from processed documents
    console.log("Finding relevant context for message:", userMessage);
    console.log("All processed chunks available:", allProcessedChunks.length);
    const relevantContextChunks = await findRelevantChunksLocal(userMessage);
    console.log("Relevant context chunks found:", relevantContextChunks.length);
    
    // Debug the content of relevant chunks 
    if (relevantContextChunks.length > 0) {
      console.log("Document context that will be sent to AI:");
      relevantContextChunks.forEach((chunk, i) => {
        console.log(`Chunk ${i}: ${chunk.text.substring(0, 100)}...`);
      });
    } else {
      console.warn("NO DOCUMENT CONTEXT FOUND - AI will respond without document knowledge");
    }

    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        content: "", // Start empty
        type: "system",
      },
    ])

    // Add a delay before the second vibration
    setTimeout(() => {
      // Add vibration when streaming begins
      navigator.vibrate(50)
    }, 200)

    // Auto-scroll to the bottom when response starts
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }

    try {
      // Reset streaming words and set streaming state
      setStreamingWords([]);
      setIsStreaming(true);

      // Track word count for periodic scrolling
      let wordCount = 0;
      let streamedContent = ""; // Accumulate streamed content

      // Prepare the full prompt with document context
      const contextPrompt = relevantContextChunks.length > 0 
        ? `Context from uploaded documents:\n---\n${relevantContextChunks.map(chunk => chunk.text).join('\n\n')}\n---\n\nUser Question: ${userMessage}`
        : userMessage;
        
      console.log("Sending to AI model:", contextPrompt.substring(0, 200) + "...");

      // Call AI with relevant chunks
      await fetch('https://dq2jqf0v-8080.inc1.devtunnels.ms/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: "tgi",
          messages: [
            {
              role: "user",
              content: contextPrompt
            }
          ],
          max_tokens: 1500,
          stream: true,
        }),
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Response body is null');
        
        const decoder = new TextDecoder();
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            
            // Process SSE data format
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                // Skip [DONE] line
                if (line.includes('[DONE]')) continue;
                
                try {
                  // Parse the JSON data
                  const jsonData = JSON.parse(line.substring(6));
                  
                  // Extract the content chunk from the response
                  if (jsonData.choices && jsonData.choices.length > 0) {
                    const contentChunk = jsonData.choices[0].delta?.content || jsonData.choices[0].message?.content || '';
                    if (contentChunk) {
                      streamedContent += contentChunk;
                      setStreamingWords((prev) => [
                        ...prev,
                        {
                          id: Date.now() + Math.random(), // Ensure unique ID
                          text: contentChunk,
                        },
                      ]);
                      
                      // Auto-scroll every 5 words to keep up with new content
                      wordCount++;
                      if (wordCount % 5 === 0 && chatContainerRef.current) {
                        requestAnimationFrame(() => {
                          if (chatContainerRef.current) {
                            chatContainerRef.current.scrollTo({
                              top: chatContainerRef.current.scrollHeight,
                              behavior: 'auto' // Use 'auto' for smoother continuous scrolling during streaming
                            });
                          }
                        });
                      }
                    }
                  }
                } catch (error) {
                  console.error('Error parsing SSE data:', error, line);
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      });

      // Update the message content *after* streaming is complete
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, content: streamedContent, completed: true } : msg
        )
      );

      // Add to completed messages set to prevent re-animation
      setCompletedMessages((prev) => new Set(prev).add(messageId))

      // Final scroll after streaming completes to ensure all content is visible
      if (chatContainerRef.current) {
        setTimeout(() => {
          if (chatContainerRef.current) {
            chatContainerRef.current.scrollTo({
              top: chatContainerRef.current.scrollHeight,
              behavior: 'smooth'
            });

            // After scrolling to end, ensure feedback buttons are visible
            scrollToEnsureFeedbackButtonsVisible();
          }
        }, 100);
      } else {
        // Ensure feedback buttons are visible after message completes
        scrollToEnsureFeedbackButtonsVisible();
      }
    } catch (error) {
      console.error("Error in AI response:", error)
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred."

      // Update with error message
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                content: `Sorry, I encountered an error: ${errorMessage}`,
                completed: true,
              }
            : msg,
      ),
    )

      // Add to completed messages set
      setCompletedMessages((prev) => new Set(prev).add(messageId))

      // Ensure feedback buttons are visible after error message
      scrollToEnsureFeedbackButtonsVisible()
    }

    // Add vibration when streaming ends
    navigator.vibrate(50)

    // Reset streaming state
    setStreamingWords([])
    setStreamingMessageId(null)
    setIsStreaming(false)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value

    // Only allow input changes when not streaming
    if (!isStreaming) {
      setInputValue(newValue)

      if (newValue.trim() !== "" && !hasTyped) {
        setHasTyped(true)
      } else if (newValue.trim() === "" && hasTyped) {
        setHasTyped(false)
      }

      const textarea = textareaRef.current
      if (textarea) {
        textarea.style.height = "auto"
        const newHeight = Math.max(24, Math.min(textarea.scrollHeight, 160))
        textarea.style.height = `${newHeight}px`
      }
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputValue.trim() && !isStreaming) {
      // Add vibration when message is submitted
      navigator.vibrate(50)

      const userMessage = inputValue.trim()

      // Add as a new section if messages already exist
      const shouldAddNewSection = messages.length > 0

      const newUserMessage = {
        id: `user-${Date.now()}`,
        content: userMessage,
        type: "user" as MessageType,
        newSection: shouldAddNewSection,
      }

      // Reset input before starting the AI response
      setInputValue("")
      setHasTyped(false)
      setActiveButton("none")

      if (textareaRef.current) {
        textareaRef.current.style.height = "auto"
      }

      // Add the message after resetting input
      setMessages((prev) => [...prev, newUserMessage])

      // Only focus the textarea on desktop, not on mobile
      if (!isMobile) {
        focusTextarea()
      } else {
        // On mobile, blur the textarea to dismiss the keyboard
        if (textareaRef.current) {
          textareaRef.current.blur()
        }
      }

      // Start AI response
      handleAIResponse(userMessage)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle Cmd+Enter on both mobile and desktop
    if (!isStreaming && e.key === "Enter" && e.metaKey) {
      e.preventDefault()
      handleSubmit(e)
      return
    }

    // Only handle regular Enter key (without Shift) on desktop
    if (!isStreaming && !isMobile && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const toggleButton = (button: ActiveButton) => {
    if (!isStreaming) {
      // Save the current selection state before toggling
      saveSelectionState()

      setActiveButton((prev) => (prev === button ? "none" : button))

      // Restore the selection state after toggling
      setTimeout(() => {
        restoreSelectionState()
      }, 0)
    }
  }

  const handleAddButtonClick = () => {
    if (!isStreaming) {
      if (fileInputRef.current) {
        fileInputRef.current.click()
      }
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    console.log("File upload triggered");
    const file = e.target.files[0];
    const fileExtension = file.name.split('.').pop()?.toLowerCase() as FileType;
    const mimeType = file.type;
    
    console.log("File details:", { 
      name: file.name, 
      type: fileExtension, 
      mimeType,
      size: file.size 
    });
    
    // Check if we have over 100MB file
    if (file.size > 100 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please upload a file smaller than 100MB",
        variant: "destructive",
      });
      return;
    }
    
    // Create a placeholder message to show file is being processed
    const placeholderId = Date.now().toString();
    
    // Add placeholder message using the existing function
    addFileMessage(file.name, fileExtension, "Processing file...", placeholderId, true, mimeType);

    try {
      let processedData;

      // Check if Python server is available for processing
      if (isPythonServerAvailable) {
        console.log("Using Python server to process file");
        // Process the file using the Python backend
        processedData = await processFile(file);
        console.log("File processed by Python server:", processedData);
        console.log("Number of chunks extracted:", processedData.chunks.length);
        
        // Debug log a sample of the chunks
        if (processedData.chunks.length > 0) {
          console.log("Sample of first chunk:", processedData.chunks[0].text.substring(0, 100) + "...");
          console.log("Vector dimension:", processedData.chunks[0].vector.length);
        }
      } else {
        // Fallback to client-side processing with limited capabilities
        processedData = await fallbackProcessFile(file, fileExtension);
      }

      // Add the processed chunks to the global context
      if (processedData && processedData.chunks.length > 0) {
        console.log("Adding processed chunks to global context:", processedData.chunks.length, "chunks");
        
        // Create a new array to ensure state changes are detected
        setAllProcessedChunks(prev => {
          // We first check if we have duplicate chunks to avoid repetition
          const existingChunkTexts = new Set(prev.map(chunk => chunk.text.trim().substring(0, 100)));
          const uniqueNewChunks = processedData.chunks.filter(
            newChunk => !existingChunkTexts.has(newChunk.text.trim().substring(0, 100))
          );
          
          console.log(`Found ${uniqueNewChunks.length} unique new chunks to add`);
          const newChunks = [...prev, ...uniqueNewChunks];
          console.log("New allProcessedChunks state:", newChunks.length, "total chunks");
          
          // Force state update since the array reference changed
          return [...newChunks];
        });
        
        // Update UI with success message
        toast({
          title: "File Processed",
          description: `${file.name} processed into ${processedData.chunks.length} chunks and added to context.`,
        });
        
        // Update the placeholder message with final file info
        updateFileMessage(
          placeholderId, 
          file.name, 
          fileExtension, 
          "File content processed", 
          processedData,
          mimeType
        );
      } else {
        throw new Error("File processing resulted in no usable chunks.");
      }
    } catch (error) {
      console.error("Error processing file:", error);
      const errorMsg = error instanceof Error ? error.message : "Unknown processing error.";
      toast({
        title: "Error processing file",
        description: `Could not process ${file.name}: ${errorMsg}`,
        variant: "destructive",
      });
      // Remove the placeholder message on error
      removeMessage(placeholderId);
    }

    // Reset file input
    if (e.target) e.target.value = "";
  }

  // Fallback file processing for when Python server is unavailable
  const fallbackProcessFile = async (file: File, fileType: FileType): Promise<{
    originalContent: string;
    chunks: ProcessedChunk[];
    fileName: string;
    fileType: string;
  }> => {
    let content = "";
    const chunks: ProcessedChunk[] = [];
    const CHUNK_SIZE = 500;
    
    // Basic text extraction
    if (fileType === 'txt') {
      content = await file.text();
    } else if (fileType === 'csv') {
      const text = await file.text();
      const result = Papa.parse(text);
      content = result.data.map(row => (row as string[]).join(', ')).join('\n');
    } else if (fileType === 'xlsx') {
      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(arrayBuffer);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][];
      content = data.map(row => row.join(', ')).join('\n');
    } else {
      // For other file types, we can only provide basic info
      content = `File ${file.name} (${fileType.toUpperCase()}) - Client-side processing limited.`;
    }
    
    // Create basic chunks without proper vectors (dummy vectors)
    for (let i = 0; i < content.length; i += CHUNK_SIZE) {
      const chunkText = content.slice(i, i + CHUNK_SIZE);
      if (chunkText.trim()) {
        chunks.push({
          text: chunkText,
          vector: new Array(512).fill(0) // Dummy vector
        });
        
        if (chunks.length >= 50) break; // Limit chunks
      }
    }
    
    return {
      originalContent: content,
      chunks,
      fileName: file.name,
      fileType
    };
  };

  // Adds or updates a file message
  const addOrUpdateFileMessage = (
    id: string,
    fileName: string,
    fileType: FileType,
    content: string | string[][] | ArrayBuffer,
    isProcessing: boolean,
    processedData?: {
      originalContent: string;
      chunks: ProcessedChunk[];
    },
    mimeType?: string
  ) => {
    const shouldAddNewSection = messages.length === 0 || messages[messages.length - 1].type !== 'file';

    const fileMessageData: FileData = {
        name: fileName,
        type: fileType,
        content, // Store content
        processed: processedData,
        mimeType
      };

    const newMessage: Message = {
      id,
      content: isProcessing ? `Processing: ${fileName}` : `File: ${fileName}`,
      type: "file",
      newSection: shouldAddNewSection,
      fileData: fileMessageData,
      completed: !isProcessing, // Mark as incomplete if processing
    };

    setMessages(prev => {
        // Check if a message with this ID already exists (for updates)
        const existingIndex = prev.findIndex(msg => msg.id === id);
        if (existingIndex > -1) {
            // Update existing message
            const updatedMessages = [...prev];
            updatedMessages[existingIndex] = newMessage;
            return updatedMessages;
        } else {
            // Add new message
            return [...prev, newMessage];
        }
    });
  };

  // Specific function to add a new file message (usually placeholder)
  const addFileMessage = (
      fileName: string,
      fileType: FileType,
      content: string | string[][] | ArrayBuffer,
      id: string,
      isProcessing: boolean,
      mimeType?: string
      ) => {
      addOrUpdateFileMessage(id, fileName, fileType, content, isProcessing, undefined, mimeType);
  }

  // Specific function to update a file message (after processing)
  const updateFileMessage = (
      id: string,
      fileName: string,
      fileType: FileType,
      content: string | string[][] | ArrayBuffer,
      processedData: {
        originalContent: string;
        chunks: ProcessedChunk[];
      },
      mimeType?: string
      ) => {
      addOrUpdateFileMessage(id, fileName, fileType, content, false, processedData, mimeType);
  }

  // Function to remove a message by ID
  const removeMessage = (id: string) => {
      setMessages(prev => prev.filter(msg => msg.id !== id));
  }

  const handleCopyText = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        toast({
          title: "Copied to clipboard",
          description: "Text has been copied to clipboard",
        })
      })
      .catch((err) => {
        console.error("Failed to copy text: ", err)
        toast({
          title: "Copy failed",
          description: "Failed to copy text to clipboard",
          variant: "destructive",
        })
      })
  }

  const handleShareText = (text: string) => {
    if (navigator.share) {
      navigator
        .share({
          text: text,
        })
        .catch((err) => {
          console.error("Share failed:", err)
        })
    } else {
      handleCopyText(text)
    }
  }

  const handleFeedback = (messageId: string, isPositive: boolean) => {
    // Here you would typically send feedback to your backend
    console.log(`Feedback for message ${messageId}: ${isPositive ? "positive" : "negative"}`)

    toast({
      title: "Feedback received",
      description: `Thank you for your ${isPositive ? "positive" : "negative"} feedback!`,
    })
  }

  const refreshPage = () => {
    console.log("Clearing chat and document context");
    // Clear processed chunks first
    setAllProcessedChunks([]);
    // Then clear messages
    setMessages([]);
    // Clear streaming state if any
    setStreamingWords([]);
    setIsStreaming(false);
    setStreamingMessageId(null);
    // Clear sections
    setMessageSections([]);
    // Confirm with toast
    toast({ 
      title: "Chat Cleared", 
      description: "Document context and conversation have been cleared"
    });
  }

  // Function to format message content with bold text and code blocks
  const formatMessageContent = (content: string) => {
    if (!content) return null;
    
    // First handle code blocks
    const codeBlockRegex = /```([a-z]*)\n([\s\S]*?)```/g;
    let formattedContent = [];
    let lastIndex = 0;
    let match;
    
    // Find all code blocks
    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Add text before code block
      if (match.index > lastIndex) {
        const textBeforeBlock = content.slice(lastIndex, match.index);
        formattedContent.push(
          <span key={`text-${lastIndex}`}>
            {formatBoldText(textBeforeBlock)}
          </span>
        );
      }
      
      // Add code block with syntax highlighting
      const language = match[1].trim() || 'plaintext';
      const code = match[2].trim();
      
      // Apply syntax highlighting
      let highlightedCode;
      try {
        if (language !== 'plaintext') {
          highlightedCode = hljs.highlight(code, { language }).value;
        } else {
          highlightedCode = hljs.highlightAuto(code).value;
        }
      } catch (e) {
        // Fallback if language mode fails
        highlightedCode = hljs.highlightAuto(code).value;
      }
      
      formattedContent.push(
        <div key={`code-${match.index}`} className="my-2 overflow-hidden rounded-md bg-gray-900 text-white">
          {language !== 'plaintext' && (
            <div className="bg-gray-800 px-4 py-1 text-xs text-gray-400">
              {language}
            </div>
          )}
          <pre className="p-4 overflow-x-auto">
            <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
          </pre>
          <div className="relative">
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-3 right-3 h-7 w-7 rounded-md bg-gray-700 p-0"
              onClick={() => handleCopyText(code)}
              aria-label="Copy code"
            >
              <Copy className="h-3.5 w-3.5 text-gray-300" />
            </Button>
          </div>
        </div>
      );
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text after the last code block
    if (lastIndex < content.length) {
      const remainingText = content.slice(lastIndex);
      formattedContent.push(
        <span key={`text-end`}>
          {formatBoldText(remainingText)}
        </span>
      );
    }
    
    return formattedContent.length > 0 ? formattedContent : formatBoldText(content);
  };

  // Helper function to format bold text (using ** syntax)
  const formatBoldText = (text: string) => {
    if (!text) return text;
    
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        // Bold text - remove the ** markers and apply bold styling
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  const renderFilePreview = (fileData: FileData) => {
    const getIcon = (type: FileType) => {
        switch (type) {
            case 'csv':
            case 'xlsx': return <FileSpreadsheet className="h-4 w-4 mr-2 flex-shrink-0" />;
            case 'pdf': return <FileText className="h-4 w-4 mr-2 flex-shrink-0" />;
            case 'docx': return <FileText className="h-4 w-4 mr-2 flex-shrink-0" />;
            case 'txt': return <FileText className="h-4 w-4 mr-2 flex-shrink-0" />;
            case 'json': return <FileText className="h-4 w-4 mr-2 flex-shrink-0" />;
            default: return <File className="h-4 w-4 mr-2 flex-shrink-0" />;
        }
    }

    const isProcessed = !!fileData.processed;
    const statusText = isProcessed ? `${fileData.processed?.chunks.length} chunks processed` : "Processing...";
    const statusColor = isProcessed ? "text-green-600 dark:text-green-400" : "text-yellow-600 dark:text-yellow-400";
    
    // Determine if we should show a preview
    const hasPreview = isProcessed && fileData.processed?.previewContent;
    
    return (
        <div className="file-preview bg-gray-100 dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="file-preview-header flex items-center justify-between mb-2">
            <div className="file-preview-title flex items-center text-sm font-medium text-gray-800 dark:text-gray-200">
              {getIcon(fileData.type)}
              <span className="truncate" title={fileData.name}>{fileData.name}</span>
            </div>
            <span className={`text-xs font-mono ${statusColor}`}>{statusText}</span>
          </div>
          
          {/* File content preview for processed files */}
          {hasPreview && (
            <div className="file-preview-content mt-2 border-t border-gray-200 dark:border-gray-700 pt-2">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Preview:</div>
              <div className="bg-gray-50 dark:bg-gray-900 rounded p-2 text-xs font-mono overflow-auto max-h-40 whitespace-pre-wrap">
                {fileData.processed?.previewContent}
              </div>
            </div>
          )}
        </div>
      );
  }

  return (
    <div
      ref={mainContainerRef}
      className={cn(
        "flex flex-col h-screen bg-background text-foreground transition-colors duration-200",
        theme,
        "overflow-hidden", // Prevent body scroll
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-between p-3 border-b border-border sticky top-0 bg-background/80 backdrop-blur-sm z-10 h-12">
        <div className="flex items-center">
          {/* Replace with Menu icon */}
          <Button variant="ghost" size="icon" className="mr-2">
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">QwickChat</h1>
        </div>
        <div className="flex items-center space-x-2">
          {/* Python server status indicator */}
          {isPythonServerAvailable ? (
            <span className="text-xs text-green-500 mr-2">Python Server Active</span>
          ) : (
            <span className="text-xs text-red-500 mr-2">Python Server Inactive</span>
          )}
          {/* Refresh button */}
          <Button variant="ghost" size="icon" onClick={refreshPage} title="Clear Chat">
            <RefreshCw className="h-5 w-5" />
          </Button>
          {/* Theme toggle button */}
          <Button variant="ghost" size="icon" onClick={toggleTheme} title="Toggle Theme">
            {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </Button>
        </div>
      </header>

      {/* Chat Content Area */}
      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto px-4 pt-12 pb-32 relative scroll-smooth"
        style={{ maxHeight: `calc(${isMobile ? viewportHeight + "px" : "100vh"} - ${HEADER_HEIGHT}px - ${INPUT_AREA_HEIGHT}px)` }}
      >
        <div className="mx-auto max-w-3xl">
          {messageSections.map((section, sectionIndex) => (
            <div key={section.id} ref={section.isActive ? newSectionRef : null} className="mb-8 last:mb-0">
              {section.messages.map((message, msgIndex) => (
                <div
                  key={message.id}
                  className={cn("flex mb-4", {
                    "justify-end": message.type === "user",
                    "justify-start": message.type === "system" || message.type === "file",
                  })}
                >
                  <div
                    className={cn("p-3 rounded-lg shadow-sm", {
                      "bg-primary text-primary-foreground max-w-[80%]": message.type === "user",
                      "bg-muted text-black w-[80%]": message.type === "system", // Changed to black text and 80% width
                      "w-full bg-muted border border-border": message.type === "file", // File messages styling
                    })}
                  >
                    {message.type === "file" && message.fileData ? (
                      renderFilePreview(message.fileData)
                    ) : message.type === "system" && streamingMessageId === message.id ? (
                      // Render streaming words
                      <div className="whitespace-pre-wrap break-words">
                        {streamingWords.map((word) => (
                          <span key={word.id}>{word.text}</span>
                        ))}
                        {/* Add blinking cursor during streaming */}
                        <span className="inline-block w-2 h-4 bg-primary animate-blink ml-1"></span>
                      </div>
                    ) : (
                      // Render completed message content with formatting
                      <div className="whitespace-pre-wrap break-words">
                        {message.type === "system" 
                          ? formatMessageContent(message.content) 
                          : message.content}
                      </div>
                    )}

                    {/* Feedback buttons for completed system messages */}
                    {message.type === "system" && message.completed && (
                      <div
                          ref={msgIndex === section.messages.length - 1 ? lastCompletedMessageRef : null} // Attach ref to the last message in the section
                          className="flex items-center justify-end space-x-2 mt-2 pt-2 border-t border-border/20"
                          >
                        <Button variant="ghost" size="icon" onClick={() => handleCopyText(message.content)} title="Copy">
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleShareText(message.content)} title="Share">
                          <Share2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleFeedback(message.id, true)} title="Like">
                          <ThumbsUp className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleFeedback(message.id, false)} title="Dislike">
                          <ThumbsDown className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div
        ref={inputContainerRef}
        className={cn(
          "sticky bottom-0 left-0 right-0 mt-auto p-4 bg-background border-t border-border",
          "transition-all duration-200 ease-in-out",
        )}
        onClick={handleInputContainerClick}
      >
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
          <div className="relative">
            <Textarea
              ref={textareaRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything..." // Default placeholder
              className={cn(
                "w-full resize-none pr-20 py-3 pl-12 min-h-[50px] max-h-[160px] overflow-y-auto",
                "rounded-full border border-input bg-transparent shadow-sm",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
              rows={1}
              disabled={isStreaming}
              style={{ height: "auto" }}
            />
            
            {/* Paperclip (upload) button inside the textarea */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute left-2 top-1/2 transform -translate-y-1/2 h-8 w-8 rounded-full"
              onClick={handleAddButtonClick}
              disabled={isStreaming}
              title="Upload File"
            >
              <Paperclip className="h-5 w-5" />
            </Button>
            
            {/* Hidden file input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              accept=".csv, .xlsx, .pdf, .docx, .txt"
            />

            {/* Submit Button */}
            <Button
              type="submit"
              size="icon"
              className={cn(
                "absolute right-3 top-1/2 transform -translate-y-1/2 h-8 w-8 rounded-full",
                "transition-opacity duration-200 bg-primary text-primary-foreground",
                !hasTyped && "opacity-70"
              )}
              disabled={isStreaming || !inputValue.trim()}
              title="Send Message"
            >
              <ArrowUp className="h-5 w-5" />
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

