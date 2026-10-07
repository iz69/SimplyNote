FROM python:3.12-slim
LABEL org.opencontainers.image.source="https://github.com/iz69/SimplyNote"

WORKDIR /

COPY requirements.txt /
RUN pip install --no-cache-dir -r requirements.txt

COPY ./src/. /api/

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
