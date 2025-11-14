FROM python:3.12-slim

WORKDIR /api

COPY api ./

RUN pip install --no-cache-dir \
    fastapi \
    uvicorn \
    pydantic \
    "python-jose[cryptography]" \
    "passlib[bcrypt]" \
    python-multipart \
    "bcrypt<4.0.0"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
##CMD ["gunicorn", "app.main:app", "-k", "uvicorn.workers.UvicornWorker", "-w", "4", "-b", "0.0.0.0:8000"]
