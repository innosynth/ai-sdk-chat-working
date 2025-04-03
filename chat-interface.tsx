"use client"

import "ios-vibrator-pro-max"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import {
  Search,
  Plus,
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
  Image,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useTheme } from "@/hooks/use-theme"
import { useToast } from "@/hooks/use-toast"
import * as XLSX from "xlsx"
import Papa from "papaparse"
import { processDocument, generateChatResponse } from '@/lib/vector-processor'

type ActiveButton = "none" | "add" | "deepSearch" | "think"
type MessageType = "user" | "system" | "file"
type FileType = "csv" | "xlsx" | "pdf" | "doc" | "docx" | "txt" | "png" | "jpg" | "jpeg" | "gif" | "unknown"

interface FileData {
  name: string
  type: FileType
  content: string | string[][] | ArrayBuffer
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

// Faster word delay for smoother streaming
const WORD_DELAY = 40 // ms per word
const CHUNK_SIZE = 2 // Number of words to add at once

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
  const [documentContext, setDocumentContext] = useState<string>('')
  // Add a ref to track the last message with feedback buttons
  const lastCompletedMessageRef = useRef<HTMLDivElement>(null)

  // Constants for layout calculations to account for the padding values
  const HEADER_HEIGHT = 48 // 12px height + padding
  const INPUT_AREA_HEIGHT = 100 // Approximate height of input area with padding
  const TOP_PADDING = 48 // pt-12 (3rem = 48px)
  const BOTTOM_PADDING = 128 // pb-32 (8rem = 128px)
  const ADDITIONAL_OFFSET = 16 // Reduced offset for fine-tuning

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

  const simulateTextStreaming = async (text: string) => {
    // Split text into words
    const words = text.split(" ")
    let currentIndex = 0
    setStreamingWords([])
    setIsStreaming(true)

    return new Promise<void>((resolve) => {
      const streamInterval = setInterval(() => {
        if (currentIndex < words.length) {
          // Add a few words at a time
          const nextIndex = Math.min(currentIndex + CHUNK_SIZE, words.length)
          const newWords = words.slice(currentIndex, nextIndex)

          setStreamingWords((prev) => [
            ...prev,
            {
              id: Date.now() + currentIndex,
              text: newWords.join(" ") + " ",
            },
          ])

          currentIndex = nextIndex
        } else {
          clearInterval(streamInterval)
          resolve()
        }
      }, WORD_DELAY)
    })
  }

  const fetchAIResponse = async (userMessage: string) => {
    try {
      const response = await fetch("http://192.168.1.1/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: userMessage }),
      })

      if (!response.ok) {
        throw new Error("Failed to get response from AI model")
      }

      const data = await response.json()
      return data.response || "I'm sorry, I couldn't generate a response at this time."
    } catch (error) {
      console.error("Error fetching AI response:", error)
      return "I'm sorry, there was an error connecting to the AI model. Please try again later."
    }
  }

  // Add a function to ensure feedback buttons are visible
  const scrollToEnsureFeedbackButtonsVisible = () => {
    setTimeout(() => {
      if (lastCompletedMessageRef.current && chatContainerRef.current) {
        const feedbackButtonsRect = lastCompletedMessageRef.current.getBoundingClientRect()
        const inputContainerRect = inputContainerRef.current?.getBoundingClientRect()
        
        if (inputContainerRect && feedbackButtonsRect.bottom > inputContainerRect.top) {
          // Calculate how much additional scrolling is needed
          const additionalScroll = feedbackButtonsRect.bottom - inputContainerRect.top + 20 // 20px extra padding
          
          chatContainerRef.current.scrollBy({
            top: additionalScroll,
            behavior: 'smooth'
          })
        }
      }
    }, 100) // Short delay to ensure DOM is updated
  }

  const handleAIResponse = async (userMessage: string) => {
    // Create a new message with empty content
    const messageId = Date.now().toString()
    setStreamingMessageId(messageId)

    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        content: "",
        type: "system",
      },
    ])

    // Add a delay before the second vibration
    setTimeout(() => {
      // Add vibration when streaming begins
      navigator.vibrate(50)
    }, 200)

    try {
      // Generate response using Gemini API with document context
      const response = await generateChatResponse(userMessage, documentContext)

      // Stream the text
      await simulateTextStreaming(response)

      // Update with complete message
      setMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, content: response, completed: true } : msg)),
      )

      // Add to completed messages set to prevent re-animation
      setCompletedMessages((prev) => new Set(prev).add(messageId))
      
      // Ensure feedback buttons are visible after message completes
      scrollToEnsureFeedbackButtonsVisible()
    } catch (error) {
      console.error("Error in AI response:", error)

      // Update with error message
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                content: "Sorry, I encountered an error while processing your request. Please try again.",
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
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0]
      const fileExtension = file.name.split('.').pop()?.toLowerCase()
      const mimeType = file.type

      // Check if file type is supported
      const supportedTypes = ['csv', 'xlsx', 'pdf', 'doc', 'docx', 'txt', 'png', 'jpg', 'jpeg', 'gif']
      if (!supportedTypes.includes(fileExtension || '')) {
        toast({
          title: "Invalid file format",
          description: "Please upload a supported file type (CSV, XLSX, PDF, DOC, DOCX, TXT, PNG, JPG, JPEG, GIF)",
          variant: "destructive",
        })
        return
      }

      try {
        let fileType: FileType = fileExtension as FileType
        let content: string | string[][] | ArrayBuffer = ""

        // Process CSV file
        if (fileExtension === "csv") {
          const text = await file.text()
          content = text
          Papa.parse(text, {
            complete: (results) => {
              addFileMessage(file.name, fileType, results.data as string[][])
              // Process document for context
              processDocument({
                name: file.name,
                type: fileType,
                content: results.data as string[][]
              }).then(processedContent => {
                setDocumentContext(processedContent)
              })
            },
            error: (error: Error) => {
              throw new Error(`Error parsing CSV: ${error}`)
            },
          })
        }
        // Process XLSX file
        else if (fileExtension === "xlsx") {
          const arrayBuffer = await file.arrayBuffer()
          content = arrayBuffer
          const workbook = XLSX.read(arrayBuffer)
          const sheetName = workbook.SheetNames[0]
          const worksheet = workbook.Sheets[sheetName]
          const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as string[][]
          addFileMessage(file.name, fileType, data)
          // Process document for context
          const processedContent = await processDocument({
            name: file.name,
            type: fileType,
            content: data
          })
          setDocumentContext(processedContent)
        }
        // Process text files
        else if (fileExtension === "txt") {
          const text = await file.text()
          content = text
          addFileMessage(file.name, fileType, text)
          // Process document for context
          setDocumentContext(text)
        }
        // Process binary files (PDF, DOC, DOCX, images)
        else {
          const arrayBuffer = await file.arrayBuffer()
          content = arrayBuffer
          addFileMessage(file.name, fileType, arrayBuffer, mimeType)
          // Process document for context
          const processedContent = await processDocument({
            name: file.name,
            type: fileType,
            content: arrayBuffer,
            mimeType
          })
          setDocumentContext(processedContent)
        }
      } catch (error) {
        console.error("Error processing file:", error)
        toast({
          title: "Error processing file",
          description: "There was an error processing your file. Please try again.",
          variant: "destructive",
        })
      }

      // Reset file input
      e.target.value = ""
    }
  }

  const addFileMessage = (fileName: string, fileType: FileType, content: string | string[][] | ArrayBuffer, mimeType?: string) => {
    // Add as a new section if messages already exist
    const shouldAddNewSection = messages.length > 0

    const newFileMessage = {
      id: `file-${Date.now()}`,
      content: `File: ${fileName}`,
      type: "file" as MessageType,
      newSection: shouldAddNewSection,
      fileData: {
        name: fileName,
        type: fileType,
        content: content,
        mimeType: mimeType
      },
    }

    // Add the file message
    setMessages((prev) => [...prev, newFileMessage])
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
    window.location.reload()
  }

  const renderFilePreview = (fileData: FileData) => {
    // Handle spreadsheet files (CSV, XLSX)
    if (fileData.type === "csv" || fileData.type === "xlsx") {
      const data = fileData.content as string[][]
      const previewData = data.slice(0, 10)

      return (
        <div className="file-preview">
          <div className="file-preview-header">
            <div className="file-preview-title">
              <FileSpreadsheet className="h-4 w-4" />
              {fileData.name}
            </div>
          </div>
          <div className="file-preview-content">
            <table className="file-preview-table">
              <thead>
                <tr>
                  {previewData[0]?.map((cell, i) => (
                    <th key={i}>{cell}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewData.slice(1).map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {data.length > 10 && <div className="text-xs text-gray-500 mt-2">Showing 10 of {data.length} rows</div>}
          </div>
        </div>
      )
    }

    // Handle text files
    if (fileData.type === "txt") {
      const text = fileData.content as string
      const previewText = text.slice(0, 500) + (text.length > 500 ? "..." : "")

      return (
        <div className="file-preview">
          <div className="file-preview-header">
            <div className="file-preview-title">
              <FileText className="h-4 w-4" />
              {fileData.name}
            </div>
          </div>
          <div className="file-preview-content">
            <pre className="whitespace-pre-wrap">{previewText}</pre>
            {text.length > 500 && <div className="text-xs text-gray-500 mt-2">Showing first 500 characters</div>}
          </div>
        </div>
      )
    }

    // Handle images
    if (fileData.type === "png" || fileData.type === "jpg" || fileData.type === "jpeg" || fileData.type === "gif") {
      const arrayBuffer = fileData.content as ArrayBuffer
      const blob = new Blob([arrayBuffer], { type: fileData.mimeType })
      const url = URL.createObjectURL(blob)

      return (
        <div className="file-preview">
          <div className="file-preview-header">
            <div className="file-preview-title">
              <Image className="h-4 w-4" />
              {fileData.name}
            </div>
          </div>
          <div className="file-preview-content">
            <img src={url} alt={fileData.name} className="max-w-full h-auto" />
          </div>
        </div>
      )
    }

    // Handle PDF, DOC, DOCX
    if (fileData.type === "pdf" || fileData.type === "doc" || fileData.type === "docx") {
      return (
        <div className="file-preview">
          <div className="file-preview-header">
            <div className="file-preview-title">
              <FileText className="h-4 w-4" />
              {fileData.name}
            </div>
          </div>
          <div className="file-preview-content">
            <p>Binary file: {fileData.name}</p>
            <p className="text-sm text-gray-500">Preview not available for this file type</p>
          </div>
        </div>
      )
    }

    return null
  }

  const renderMessage = (message: Message) => {
    const isCompleted = completedMessages.has(message.id)

    if (message.type === "file" && message.fileData) {
      return (
        <div key={message.id} className="flex flex-col items-end">
          <div className="max-w-[80%]">{renderFilePreview(message.fileData)}</div>
        </div>
      )
    }

    return (
      <div key={message.id} className={cn("flex flex-col", message.type === "user" ? "items-end" : "items-start")}>
        <div
          className={cn(
            "max-w-[80%] px-4 py-2 rounded-2xl",
            message.type === "user"
              ? "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-br-none"
              : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100",
          )}
        >
          {/* For user messages or completed system messages, render without animation */}
          {message.content && (
            <span className={message.type === "system" && !isCompleted ? "animate-fade-in" : ""}>
              {message.content}
            </span>
          )}

          {/* For streaming messages, render with animation */}
          {message.id === streamingMessageId && (
            <span className="inline">
              {streamingWords.map((word) => (
                <span key={word.id} className="animate-fade-in inline">
                  {word.text}
                </span>
              ))}
            </span>
          )}
        </div>

        {/* Message actions */}
        {message.type === "system" && message.completed && (
          <div 
            ref={message.id === Array.from(completedMessages).pop() ? lastCompletedMessageRef : null}
            className="flex items-center gap-2 px-4 mt-1 mb-2"
          >
            <button
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              onClick={() => handleCopyText(message.content)}
              aria-label="Copy to clipboard"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              onClick={() => handleShareText(message.content)}
              aria-label="Share"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <button
              className="text-gray-400 hover:text-green-500 transition-colors"
              onClick={() => handleFeedback(message.id, true)}
              aria-label="Like"
            >
              <ThumbsUp className="h-4 w-4" />
            </button>
            <button
              className="text-gray-400 hover:text-red-500 transition-colors"
              onClick={() => handleFeedback(message.id, false)}
              aria-label="Dislike"
            >
              <ThumbsDown className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    )
  }

  // Determine if a section should have fixed height (only for sections after the first)
  const shouldApplyHeight = (sectionIndex: number) => {
    return sectionIndex > 0
  }

  return (
    <div
      ref={mainContainerRef}
      className="bg-gray-50 dark:bg-gray-900 flex flex-col overflow-hidden"
      style={{ height: isMobile ? `${viewportHeight}px` : "100svh" }}
    >
      <header className="fixed top-0 left-0 right-0 h-12 flex items-center px-4 z-20 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="w-full flex items-center justify-between px-2">
          <Button variant="ghost" size="icon" className="rounded-full h-8 w-8">
            <Menu className="h-5 w-5 text-gray-700 dark:text-gray-300" />
            <span className="sr-only">Menu</span>
          </Button>

          <h1 className="text-base font-medium text-gray-800 dark:text-gray-200">Luminar Chat</h1>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full h-8 w-8"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? (
                <Sun className="h-5 w-5 text-gray-300" />
              ) : (
                <Moon className="h-5 w-5 text-gray-700" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full h-8 w-8"
              onClick={refreshPage}
              aria-label="Refresh page"
            >
              <RefreshCw className="h-5 w-5 text-gray-700 dark:text-gray-300" />
            </Button>
          </div>
        </div>
      </header>

      <div ref={chatContainerRef} className="flex-grow pb-32 pt-12 px-4 overflow-y-auto">
        <div className="max-w-3xl mx-auto space-y-4">
          {messageSections.map((section, sectionIndex) => (
            <div
              key={section.id}
              ref={sectionIndex === messageSections.length - 1 && section.isNewSection ? newSectionRef : null}
            >
              {section.isNewSection && (
                <div
                  style={
                    section.isActive && shouldApplyHeight(section.sectionIndex)
                      ? { height: `${getContentHeight()}px` }
                      : {}
                  }
                  className="pt-4 flex flex-col justify-start"
                >
                  {section.messages.map((message) => renderMessage(message))}
                </div>
              )}

              {!section.isNewSection && <div>{section.messages.map((message) => renderMessage(message))}</div>}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
          <div
            ref={inputContainerRef}
            className={cn(
              "relative w-full rounded-3xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 cursor-text",
              isStreaming && "opacity-80",
            )}
            onClick={handleInputContainerClick}
          >
            <div className="pb-9">
              <Textarea
                ref={textareaRef}
                placeholder={isStreaming ? "Waiting for response..." : "Ask Anything"}
                className="min-h-[24px] max-h-[160px] w-full rounded-3xl border-0 bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 placeholder:text-base focus-visible:ring-0 focus-visible:ring-offset-0 text-base pl-2 pr-4 pt-0 pb-0 resize-none overflow-y-auto leading-tight"
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                  // Ensure the textarea is scrolled into view when focused
                  if (textareaRef.current) {
                    textareaRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
                  }
                }}
              />
            </div>

            <div className="absolute bottom-3 left-3 right-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept=".csv,.xlsx,.pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.gif"
                    onChange={handleFileChange}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className={cn(
                      "rounded-full h-8 w-8 flex-shrink-0 border-gray-200 dark:border-gray-700 p-0 transition-colors",
                      activeButton === "add" && "bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600",
                    )}
                    onClick={handleAddButtonClick}
                    disabled={isStreaming}
                    aria-label="Upload file"
                  >
                    <Plus
                      className={cn(
                        "h-4 w-4 text-gray-500 dark:text-gray-400",
                        activeButton === "add" && "text-gray-700 dark:text-gray-300",
                      )}
                    />
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "rounded-full h-8 px-3 flex items-center border-gray-200 dark:border-gray-700 gap-1.5 transition-colors",
                      activeButton === "deepSearch" &&
                        "bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600",
                    )}
                    onClick={() => toggleButton("deepSearch")}
                    disabled={isStreaming}
                  >
                    <Search
                      className={cn(
                        "h-4 w-4 text-gray-500 dark:text-gray-400",
                        activeButton === "deepSearch" && "text-gray-700 dark:text-gray-300",
                      )}
                    />
                    <span
                      className={cn(
                        "text-gray-900 dark:text-gray-100 text-sm",
                        activeButton === "deepSearch" && "font-medium",
                      )}
                    >
                      DeepSearch
                    </span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "rounded-full h-8 px-3 flex items-center border-gray-200 dark:border-gray-700 gap-1.5 transition-colors",
                      activeButton === "think" && "bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600",
                    )}
                    onClick={() => toggleButton("think")}
                    disabled={isStreaming}
                  >
                    <Lightbulb
                      className={cn(
                        "h-4 w-4 text-gray-500 dark:text-gray-400",
                        activeButton === "think" && "text-gray-700 dark:text-gray-300",
                      )}
                    />
                    <span
                      className={cn(
                        "text-gray-900 dark:text-gray-100 text-sm",
                        activeButton === "think" && "font-medium",
                      )}
                    >
                      Think
                    </span>
                  </Button>
                </div>

                <Button
                  type="submit"
                  variant="outline"
                  size="icon"
                  className={cn(
                    "rounded-full h-8 w-8 border-0 flex-shrink-0 transition-all duration-200",
                    hasTyped ? "bg-black dark:bg-white scale-110" : "bg-gray-200 dark:bg-gray-700",
                  )}
                  disabled={!inputValue.trim() || isStreaming}
                >
                  <ArrowUp
                    className={cn(
                      "h-4 w-4 transition-colors",
                      hasTyped ? "text-white dark:text-black" : "text-gray-500 dark:text-gray-400",
                    )}
                  />
                  <span className="sr-only">Submit</span>
                </Button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

