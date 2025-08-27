# Base with Python + build tools
FROM python:3.10-slim

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    redis-server supervisor ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

# Create workdir
WORKDIR /app

# Copy project
# (If your repo contains the Dev_Fabric/ directory, copy the whole repo.)
COPY . /app/

# Python deps
RUN pip install --no-cache-dir -r Dev_Fabric/requirements.txt

# Supervisord config
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Non-root user (optional)
RUN useradd -m -u 1000 spaceuser && chown -R spaceuser:spaceuser /app /var/log /var/run
USER spaceuser

# Hugging Face injects PORT; default to 7860 for local
ENV PORT=7860
# Ensure FastAPI sees production-ish host/port
ENV HOST=0.0.0.0

# Use tini as simple init
ENTRYPOINT ["/usr/bin/tini", "--"]

# One container, multiple processes via supervisord
CMD ["supervisord", "-n", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
