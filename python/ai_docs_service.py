import os
import sys
# Protobuf C-extension hatasını önlemek için (Özellikle Python 3.14'te) saf Python implementasyonunu kullanmaya zorluyoruz:
os.environ["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"

import pika
import requests
from google import genai
from config import *

class AIDocsService:
    def __init__(self, rabbitmq_host, input_queue, api_endpoint, gemini_api_key):
        self.rabbitmq_host = rabbitmq_host
        self.input_queue = input_queue
        self.api_endpoint = api_endpoint
        self.client = genai.Client(api_key=gemini_api_key)
        self.connection = None
        self.channel = None

    def setup_rabbitmq(self):
        import time
        # Connect to RabbitMQ with retry
        retries = 10
        while retries > 0:
            try:
                self.connection = pika.BlockingConnection(pika.ConnectionParameters(host=self.rabbitmq_host))
                break
            except pika.exceptions.AMQPConnectionError:
                print(f" [!] RabbitMQ not ready, retrying in 5 seconds... ({retries} retries left)")
                time.sleep(5)
                retries -= 1
        if not self.connection:
            raise Exception("Could not connect to RabbitMQ")
            
        self.channel = self.connection.channel()

        # Declare the input queue (durable=True survives RabbitMQ restarts)
        self.channel.queue_declare(queue=self.input_queue, durable=True)

        # Fair dispatch: don't give more than one message to a worker at a time
        self.channel.basic_qos(prefetch_count=1)

    def get_gemini_response(self, prompt):
        """Calls Gemini API to generate content based on the prompt."""
        try:
            response = self.client.models.generate_content(
                model='gemini-3.5-flash',
                contents=prompt
            )
            return response.text
        except Exception as e:
            print(f"Error calling Gemini API: {e}")
            return f"Error: {str(e)}"

    def send_to_api(self, payload):
        """Gelen veriyi belirtilen endpoint'e POST eder."""
        try:
            headers = {'Content-Type': 'application/json'}
            response = requests.post(self.api_endpoint, json=payload, headers=headers)
            print(f" [x] API POST Request Status Code: {response.status_code}")
        except Exception as e:
            print(f" [!] Hata: API'ye POST edilirken bir hata oluştu: {e}")

    def callback(self, ch, method, properties, body):
        import json
        try:
            # Decode the message
            message = body.decode('utf-8')
            print(f" [x] Received request from '{self.input_queue}'")
            
            data_dict = json.loads(message)
            repo_full_name = data_dict.get("repoFullName", "")
            changes = data_dict.get("changes", [])
            
            if not changes:
                print(" [!] No changes found in message.")
                ch.basic_ack(delivery_tag=method.delivery_tag)
                return

            # Prepare prompt with all diffs
            diff_text = ""
            for change in changes:
                filename = change.get("filename", "Unknown")
                patch = change.get("patch", "")
                diff_text += f"\n--- {filename} ---\n{patch}\n"
            
            prompt = f"Aşağıdaki değişiklik (diff/patch) kayıtlarını incele ve projenin autodoc.md dokümantasyonunu bu değişikliklere göre nasıl güncellememiz gerektiğini Markdown formatında yaz:\n{diff_text}"

            # Call Gemini API
            print(" [x] Processing with Gemini API...")
            gemini_response = self.get_gemini_response(prompt)
            
            # Post the response to the specified API
            print(f" [x] Sending Gemini response to {self.api_endpoint}...")
            payload = {
                "repoFullName": repo_full_name,
                "markdownContent": gemini_response
            }
            self.send_to_api(payload)
            
            # Acknowledge the message so RabbitMQ knows it's processed
            ch.basic_ack(delivery_tag=method.delivery_tag)
            
        except Exception as e:
            print(f" [!] Error processing message: {e}")
            # Reject message and don't requeue if there's a fatal error
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

    def start(self):
        self.setup_rabbitmq()
        self.channel.basic_consume(queue=self.input_queue, on_message_callback=self.callback)

        print(f" [*] Waiting for messages in '{self.input_queue}'. To exit press CTRL+C")
        try:
            self.channel.start_consuming()
        except KeyboardInterrupt:
            print(f"\n[AIDocsService] Interrupted by user. Closing connection...")
            if self.connection and not self.connection.is_closed:
                self.connection.close()

if __name__ == '__main__':
    service = AIDocsService(RABBITMQ_HOST, CONTEXT_READY_QUEUE, API_ENDPOINT, GEMINI_API_KEY)
    service.start()
