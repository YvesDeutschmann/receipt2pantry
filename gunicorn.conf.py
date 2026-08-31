"""Gunicorn configuration for production deployment."""

import os

bind = f"0.0.0.0:{os.environ.get('PORT', '8080')}"
workers = int(os.environ.get("WEB_CONCURRENCY", "2"))
worker_class = "sync"
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "300"))
keepalive = 5
preload_app = False
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("LOG_LEVEL", "info").lower()
