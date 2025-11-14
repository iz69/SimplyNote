FROM python:3.12-slim

WORKDIR /

COPY . /api

RUN pip install --no-cache-dir \
    fastapi \
    uvicorn \
    pydantic \
    "python-jose[cryptography]" \
    "passlib[bcrypt]" \
    python-multipart \
    "bcrypt<4.0.0"

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]

##CMD ["gunicorn", "api.main:app", "-k", "uvicorn.workers.UvicornWorker", "-w", "4", "-b", "0.0.0.0:8000"]
