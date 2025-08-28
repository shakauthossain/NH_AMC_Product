FROM python:3.10-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    redis-server supervisor ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app/
RUN pip install --no-cache-dir -r requirements.txt

COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
RUN useradd -m -u 1000 spaceuser && chown -R spaceuser:spaceuser /app /var/log /var/run
USER spaceuser

ENV PORT=7860 HOST=0.0.0.0 PYTHONPATH=/app

ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["supervisord","-n","-c","/etc/supervisor/conf.d/supervisord.conf"]
