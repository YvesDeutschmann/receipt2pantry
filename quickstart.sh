#!/bin/bash
# Quick start script for Meald development

echo "🚀 Meald Quick Start"
echo "=========================="
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Creating from template..."
    cp .env.example .env
    echo "✅ Created .env file. Please edit it with your configuration."
    echo ""
fi

# Install Python dependencies
echo "📦 Installing Python dependencies..."
uv sync

# Check if frontend dependencies are installed
if [ ! -d "frontend/node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    cd frontend
    npm install
    cd ..
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the application:"
echo "  Backend:  uv run python backend/app.py"
echo "  Frontend: cd frontend && npm run dev"
echo ""
echo "Or run in separate terminals:"
echo "  Terminal 1: ./run_backend.sh"
echo "  Terminal 2: ./run_frontend.sh"
echo ""
echo "Visit http://localhost:5173 when both servers are running"
echo ""

