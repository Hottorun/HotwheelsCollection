FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# curl is used by the compose healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Requirements first so image rebuilds skip the dependency install when only
# application code changed.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Images live on a mounted volume, not in the image itself.
RUN mkdir -p /data/car-images
ENV IMAGE_DIR=/data/car-images

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
