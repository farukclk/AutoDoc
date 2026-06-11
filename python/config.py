import os

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

RABBITMQ_HOST = os.getenv("RABBITMQ_HOST", "localhost")
CODE_FETCHED_QUEUE = os.getenv("CODE_FETCHED_QUEUE", "CodeFetched")
CONTEXT_READY_QUEUE = os.getenv("CONTEXT_READY_QUEUE", "ContextReady")
API_ENDPOINT = os.getenv("API_ENDPOINT", "http://localhost:3001/publish")