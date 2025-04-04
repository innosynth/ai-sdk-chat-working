import os
import sys
import json
import tempfile
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
from io import BytesIO, StringIO
import tensorflow_hub as hub
import tensorflow as tf
import PyPDF2
from docx import Document
import base64
import traceback
import socket

# Initialize Flask app
app = Flask(__name__)
# Enable CORS for all routes
CORS(app, resources={r"/*": {"origins": "*"}})

# Configuration
CHUNK_SIZE = 500  # Characters per chunk
MAX_CHUNKS = 50  # Maximum number of chunks to process

# Function to check if a port is in use
def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('localhost', port)) == 0

# Function to find an available port
def find_available_port(start_port, max_attempts=10):
    port = start_port
    for _ in range(max_attempts):
        if not is_port_in_use(port):
            return port
        port += 1
    # If we can't find an available port, return None
    return None

# Initialize Universal Sentence Encoder
@tf.function
def get_message_embedding(message):
    return embed(tf.constant([message]))[0]

# Load model - lazy loading to improve startup time
embed = None
def load_model():
    global embed
    if embed is None:
        print("Loading Universal Sentence Encoder model...")
        embed = hub.load("https://tfhub.dev/google/universal-sentence-encoder/4")
        print("Model loaded!")
    return embed

# Define routes
@app.route('/health', methods=['GET'])
def health_check():
    print("Health check request received")
    return jsonify({"status": "healthy"})

@app.route('/process', methods=['POST'])
def process_document():
    print("Process document request received")
    # Ensure model is loaded
    try:
        load_model()
    except Exception as e:
        print(f"Error loading model: {str(e)}")
        return jsonify({"error": f"Error loading model: {str(e)}"}), 500
    
    try:
        # Extract file data from request
        file_data = request.files.get('file')
        file_type = request.form.get('fileType')
        file_name = request.form.get('fileName')
        
        print(f"Processing file: {file_name}, type: {file_type}")
        
        if not file_data or not file_type:
            return jsonify({"error": "Missing file data or file type"}), 400
        
        # Process file based on type
        chunks = []
        original_content = ""
        preview_content = ""
        
        if file_type in ['csv', 'xlsx']:
            # Process spreadsheet
            try:
                if file_type == 'csv':
                    df = pd.read_csv(file_data)
                else:  # xlsx
                    df = pd.read_excel(file_data)
                
                # Create a more structured representation
                # First create a preview with a table-like format for the UI
                preview_rows = []
                # Add headers in a nice format
                if not df.empty:
                    headers = df.columns.tolist()
                    preview_rows.append("| " + " | ".join(str(h) for h in headers) + " |")
                    preview_rows.append("| " + " | ".join("-" * len(str(h)) for h in headers) + " |")
                    
                    # Add data rows (limit to first 20 for preview)
                    for i, row in df.head(20).iterrows():
                        preview_rows.append("| " + " | ".join(str(val) for val in row.values) + " |")
                
                preview_content = "\n".join(preview_rows)
                
                # For vectorization, use a more structured format
                data_rows = []
                for i, row in df.iterrows():
                    # For each row, format as "col1: value1, col2: value2, ..."
                    row_str = ", ".join(f"{col}: {val}" for col, val in zip(df.columns, row.values))
                    data_rows.append(row_str)
                
                headers_str = "Columns: " + ", ".join(df.columns.tolist())
                structure_info = f"Format: {df.shape[0]} rows x {df.shape[1]} columns"
                
                # Create a structured representation
                original_content = f"{headers_str}\n{structure_info}\n\nData:\n" + "\n".join(data_rows)
            except Exception as e:
                print(f"Error processing {file_type} file: {str(e)}")
                return jsonify({"error": f"Error processing {file_type} file: {str(e)}"}), 400
            
        elif file_type == 'txt':
            # Process text file
            original_content = file_data.read().decode('utf-8')
            preview_content = original_content[:1000] + ("..." if len(original_content) > 1000 else "")
            
        elif file_type == 'json':
            try:
                # Parse JSON file
                json_data = json.loads(file_data.read().decode('utf-8'))
                
                # Create a pretty-printed version for preview
                preview_content = json.dumps(json_data, indent=2)[:1000] + ("..." if len(json.dumps(json_data, indent=2)) > 1000 else "")
                
                # Create a flattened representation for chunking
                if isinstance(json_data, list):
                    # For arrays of objects/values
                    json_str_parts = []
                    for i, item in enumerate(json_data):
                        if isinstance(item, dict):
                            # Format dict items as "key: value, key2: value2"
                            item_str = f"Item {i}: " + ", ".join(f"{k}: {v}" for k, v in item.items())
                        else:
                            item_str = f"Item {i}: {item}"
                        json_str_parts.append(item_str)
                    original_content = "JSON Array:\n" + "\n".join(json_str_parts)
                elif isinstance(json_data, dict):
                    # For objects, format as "key: value" pairs
                    json_str_parts = []
                    for key, value in json_data.items():
                        if isinstance(value, (dict, list)):
                            value_str = json.dumps(value)
                        else:
                            value_str = str(value)
                        json_str_parts.append(f"{key}: {value_str}")
                    original_content = "JSON Object:\n" + "\n".join(json_str_parts)
                else:
                    # For primitive types
                    original_content = f"JSON Value: {json_data}"
            except json.JSONDecodeError as e:
                print(f"Error parsing JSON file: {str(e)}")
                return jsonify({"error": f"Invalid JSON file: {str(e)}"}), 400
            
        elif file_type == 'pdf':
            # Process PDF file
            pdf_reader = PyPDF2.PdfReader(file_data)
            text_content = []
            for page_num in range(len(pdf_reader.pages)):
                text_content.append(pdf_reader.pages[page_num].extract_text())
            original_content = "\n".join(text_content)
            preview_content = original_content[:1000] + ("..." if len(original_content) > 1000 else "")
            
        elif file_type == 'docx':
            # Process DOCX file
            doc = Document(file_data)
            paragraphs = [para.text for para in doc.paragraphs if para.text.strip()]
            original_content = "\n".join(paragraphs)
            preview_content = original_content[:1000] + ("..." if len(original_content) > 1000 else "")
        else:
            return jsonify({"error": f"Unsupported file type: {file_type}"}), 400
        
        print(f"Extracted {len(original_content)} characters from file")
        
        # If no preview content was set, use the first part of original content
        if not preview_content:
            preview_content = original_content[:1000] + ("..." if len(original_content) > 1000 else "")
        
        # Chunk the content
        text_to_chunk = original_content
        for i in range(0, len(text_to_chunk), CHUNK_SIZE):
            if len(chunks) >= MAX_CHUNKS:
                print(f"Reached maximum chunks limit ({MAX_CHUNKS})")
                break
            chunk_text = text_to_chunk[i:i + CHUNK_SIZE]
            if chunk_text.strip():
                # Get embedding for the chunk
                embedding = get_message_embedding(chunk_text).numpy().tolist()
                chunks.append({
                    "text": chunk_text,
                    "vector": embedding
                })
        
        if not chunks and text_to_chunk.strip():
            # If no chunks were created but text exists, create one chunk
            chunk_text = text_to_chunk[:CHUNK_SIZE]
            embedding = get_message_embedding(chunk_text).numpy().tolist()
            chunks.append({
                "text": chunk_text,
                "vector": embedding
            })
        
        print(f"Created {len(chunks)} chunks from file")
            
        # Return processed data
        return jsonify({
            "originalContent": original_content,
            "previewContent": preview_content,
            "chunks": chunks,
            "fileName": file_name,
            "fileType": file_type
        })
        
    except Exception as e:
        print(f"Error processing document: {str(e)}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/vectorize', methods=['POST'])
def vectorize_text():
    print("Vectorize text request received")
    # Ensure model is loaded
    try:
        load_model()
    except Exception as e:
        print(f"Error loading model: {str(e)}")
        return jsonify({"error": f"Error loading model: {str(e)}"}), 500
    
    try:
        data = request.get_json()
        text = data.get('text')
        
        if not text:
            return jsonify({"error": "Missing text parameter"}), 400
        
        # Get embedding for the text
        embedding = get_message_embedding(text).numpy().tolist()
        
        print(f"Created vector for text: '{text[:50]}...'")
        
        return jsonify({
            "text": text,
            "vector": embedding
        })
        
    except Exception as e:
        print(f"Error vectorizing text: {str(e)}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/find_relevant', methods=['POST'])
def find_relevant_chunks():
    print("\n=============================================")
    print("FIND RELEVANT CHUNKS REQUEST RECEIVED")
    print("=============================================")
    try:
        data = request.get_json()
        query = data.get('query')
        chunks = data.get('chunks')
        threshold = data.get('threshold', 0.7)
        max_chunks = data.get('maxChunks', 5)
        
        print(f"Query: '{query}'")
        print(f"Received {len(chunks) if chunks else 0} chunks for matching")
        print(f"Threshold: {threshold}, Max chunks: {max_chunks}")
        
        # Print a sample of the chunks for debugging
        if chunks and len(chunks) > 0:
            print(f"Sample text from first chunk: {chunks[0]['text'][:100]}...")
            print(f"Vector length of first chunk: {len(chunks[0]['vector'])}")
        
        if not query or not chunks:
            print("Missing query or chunks")
            return jsonify({"error": "Missing query or chunks"}), 400
        
        # Get query embedding
        query_vector = get_message_embedding(query).numpy()
        print(f"Generated query vector of length {len(query_vector)}")
        
        # Calculate similarities
        similarities = []
        for i, chunk in enumerate(chunks):
            chunk_vector = np.array(chunk['vector'])
            # Calculate cosine similarity
            similarity = np.dot(query_vector, chunk_vector) / (
                np.linalg.norm(query_vector) * np.linalg.norm(chunk_vector)
            )
            similarities.append({
                "index": i,
                "chunk": chunk,
                "similarity": float(similarity)
            })
        
        # Sort by similarity and filter
        filtered_chunks = [
            s['chunk'] for s in sorted(similarities, key=lambda x: x['similarity'], reverse=True)
            if s['similarity'] > threshold
        ][:max_chunks]
        
        # Log similarity scores for debugging
        sorted_similarities = sorted(similarities, key=lambda x: x['similarity'], reverse=True)
        print("\nTOP SIMILARITY SCORES:")
        for i, s in enumerate(sorted_similarities[:10]):  # Log top 10 similarities
            print(f"Chunk {i} (index {s['index']}): similarity {s['similarity']:.4f}")
            print(f"   Text: {s['chunk']['text'][:100]}...")
        
        print(f"\nFound {len(filtered_chunks)} relevant chunks after filtering (threshold: {threshold})")
        print(f"Return {len(filtered_chunks)} chunks to client")
        print("=============================================\n")
        
        return jsonify({
            "query": query,
            "relevantChunks": filtered_chunks,
            "count": len(filtered_chunks)
        })
        
    except Exception as e:
        print(f"ERROR finding relevant chunks: {str(e)}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# Startup message
print("=== Python Server Initialization ===")
print(f"Python version: {sys.version}")
print(f"TensorFlow version: {tf.__version__}")
print("Server starting...")

if __name__ == '__main__':
    # Set host and port from environment variables or use defaults
    host = os.environ.get('HOST', '0.0.0.0')  # Changed to 0.0.0.0 to allow external connections
    port = 5002  # Fixed to port 5002 only
    
    print(f"Starting server on {host}:{port}")
    
    try:
        app.run(host=host, port=port, debug=True)
    except OSError as e:
        print(f"ERROR: Could not start server: {e}")
        print("Please ensure port 5002 is not in use by another process.")
        print("You can kill processes using this port with: lsof -i :5002 | awk 'NR>1 {print $2}' | xargs kill -9")
        sys.exit(1) 