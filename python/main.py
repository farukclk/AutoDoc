import time
from multiprocessing import Process

from config import *
from code_parsing_service import CodeParsingService
from ai_docs_service import AIDocsService

def run_code_parsing():
    service = CodeParsingService(RABBITMQ_HOST, CODE_FETCHED_QUEUE, CONTEXT_READY_QUEUE)
    service.start()

def run_ai_docs():
    service = AIDocsService(RABBITMQ_HOST, CONTEXT_READY_QUEUE, API_ENDPOINT, GEMINI_API_KEY)
    service.start()

def main():
    print("Class tabanlı servisler başlatılıyor...")

    # multiprocessing.Process ile aynı Python kodu içerisinde iki farklı işlem yaratıyoruz
    p1 = Process(target=run_code_parsing)
    p2 = Process(target=run_ai_docs)

    p1.start()
    p2.start()

    print("Servisler başarıyla başlatıldı. Çıkmak için CTRL+C tuşlarına basın.\n")

    try:
        p1.join()
        p2.join()
    except KeyboardInterrupt:
        print("\nKullanıcı tarafından durdurulma isteği alındı. Servisler kapatılıyor...")
        p1.terminate()
        p2.terminate()
        p1.join()
        p2.join()
        print("Tüm servisler başarıyla kapatıldı.")

if __name__ == '__main__':
    main()
