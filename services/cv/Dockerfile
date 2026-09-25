# Detection V2 — CV service image (deploy/CI only; dev runs Windows-native).
FROM python:3.11-slim
WORKDIR /srv/cv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8001
CMD ["python", "app.py"]
