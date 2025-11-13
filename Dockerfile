FROM python:3.12-slim

WORKDIR /app

COPY app ./app

RUN pip install --no-cache-dir \
    fastapi \
    uvicorn \
    pydantic \
    "python-jose[cryptography]" \
    "passlib[bcrypt]" \
    python-multipart \
    "bcrypt<4.0.0"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]

