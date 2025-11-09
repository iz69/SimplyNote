FROM python:3.12-slim

WORKDIR /app

COPY app ./app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]


## # ---------------------------------
## # Build stage for React (Vite)
## # ---------------------------------
## FROM node:20 AS ui-build
## WORKDIR /ui
## COPY ui/package*.json ./
## RUN npm install
## COPY ui/ .
## RUN npm run build
## 
## # ---------------------------------
## # Main stage for FastAPI
## # ---------------------------------
## FROM python:3.12-slim
## WORKDIR /app
## 
## # Backend の依存をインストール
## COPY requirements.txt .
## RUN pip install --no-cache-dir -r requirements.txt
## 
## # FastAPI アプリ
## COPY app/ ./app/
## 
## # React build 結果をコピー
## COPY --from=ui-build /ui/dist ./ui/dist
## 
## # 起動
## CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
## 
