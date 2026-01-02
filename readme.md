# Oeffi (MVG) Dashboard

A lightweight Flask-based web app to create and view personalized public transport dashboards.

## Features
- Owner-token based access (no account required)
- Dashboard creation & editing
- Secure cookies (HttpOnly)
- Mobile-friendly UI

## Tech Stack
- Python (Flask)
- SQLite
- Vanilla JS / HTML / CSS
- Gunicorn + Nginx (production)

## Requirements

- Python 3.12+

## Setup (Local)
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export FLASK_SECRET_KEY=dev
flask run
