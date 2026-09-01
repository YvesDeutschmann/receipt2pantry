"""WSGI entrypoint for production servers (gunicorn)."""

from backend.app import create_app

app = create_app()
