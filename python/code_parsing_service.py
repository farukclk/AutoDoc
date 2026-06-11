import pika
import sys
import os
from config import *

class CodeParsingService:
    def __init__(self, rabbitmq_host, input_queue, output_queue):
        self.rabbitmq_host = rabbitmq_host
        self.input_queue = input_queue
        self.output_queue = output_queue
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

        # Declare the queues (durable=True survives RabbitMQ restarts)
        self.channel.queue_declare(queue=self.input_queue, durable=True)
        self.channel.queue_declare(queue=self.output_queue, durable=True)

        # Fair dispatch: don't give more than one message to a worker at a time
        self.channel.basic_qos(prefetch_count=1)

    def preprocess_data(self, data):
        """
        Ön işleme fonksiyonu. Şu anlık gelen veriyi direkt döndürüyor.
        """
        return data

    def callback(self, ch, method, properties, body):
        try:
            # Decode the message
            message = body.decode('utf-8')
            print(f" [x] Received request from '{self.input_queue}': {message}")
            
            # Ön işlemden geçir
            processed_message = self.preprocess_data(message)
            
            # Output kuyruğuna at
            ch.basic_publish(
                exchange='',
                routing_key=self.output_queue,
                body=processed_message,
                properties=pika.BasicProperties(
                    delivery_mode=pika.spec.PERSISTENT_DELIVERY_MODE
                )
            )
            print(f" [x] Sent processed data to '{self.output_queue}' queue.")
            
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
            print(f"\n[CodeParsingService] Interrupted by user. Closing connection...")
            if self.connection and not self.connection.is_closed:
                self.connection.close()

if __name__ == '__main__':
    service = CodeParsingService(RABBITMQ_HOST, CODE_FETCHED_QUEUE, CONTEXT_READY_QUEUE)
    service.start()
