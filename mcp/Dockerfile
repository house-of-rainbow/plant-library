# MCP server container. Build context is the repository root so it can reuse the
# backend's data layer (backend/app):
#   docker build -f mcp/Dockerfile -t plant-mcp .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /srv

COPY mcp/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Reuse the backend domain layer + the MCP server entrypoint.
COPY backend/app ./app
COPY mcp/server.py ./server.py

EXPOSE 8000

CMD ["python", "server.py"]
