"""
Flask application for managing public transportation dashboards.

This application allows users to create and manage dashboards displaying
real-time departure information from public transportation stations.
"""
import asyncio
import os
from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    redirect,
    abort,
    make_response,
)
from services.stations_service import StationsService
from services.mvg_service import MvgService
from services.dashboard_service import DashboardService
from services.owner_service import OwnerService

# Configuration constants
DB_PATH = "data/app.db"
STATIONS_CSV_PATH = "data/Haltestellen.csv"
COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 5  # 5 years
DEFAULT_STATION_SEARCH_LIMIT = 10

# Initialize Flask app
app = Flask(__name__, template_folder="web/templates", static_folder="web/static")

# Initialize services
stations_service = StationsService(STATIONS_CSV_PATH)
mvg_service = MvgService()
dashboard_service = DashboardService(DB_PATH)
owner_service = OwnerService(DB_PATH)

# Configure Flask app
# Note: In production, set FLASK_SECRET_KEY environment variable
# and ensure HTTPS is enabled (secure=True for cookies)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-change-me")
app.config.update(
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)

def require_owner_id_ui():
    """
    Get owner ID from cookie for UI routes.

    Returns:
        Owner ID if valid token exists, None otherwise
    """
    token = request.cookies.get("owner_token")
    owner_id = owner_service.get_owner_id_by_token(token) if token else None
    return owner_id if owner_id else None


def require_owner_id_api():
    """
    Require valid owner ID from cookie for API routes.

    Returns:
        Owner ID if valid token exists

    Raises:
        401 Unauthorized if no valid token is found
    """
    token = request.cookies.get("owner_token")
    owner_id = owner_service.get_owner_id_by_token(token) if token else None
    if not owner_id:
        abort(401)
    return owner_id


def _set_owner_cookie(response, token: str, secure: bool = False) -> None:
    """
    Set owner authentication cookie on response.

    Args:
        response: Flask response object
        token: Authentication token
        secure: Whether to set secure flag (use True in production with HTTPS)
    """
    response.set_cookie(
        "owner_token",
        token,
        httponly=True,
        samesite="Lax",
        secure=secure,
        max_age=COOKIE_MAX_AGE_SECONDS,
    )



# ============================================================================
# Authentication Routes
# ============================================================================


@app.get("/start")
def start():
    """
    Start page for new users.

    Creates a new owner account and displays a claim link.
    If user already has a valid token, redirects to home.
    """
    token = request.cookies.get("owner_token")
    if token and owner_service.get_owner_id_by_token(token):
        return redirect("/")

    owner_id, token = owner_service.create_owner()
    claim_link = f"/claim/{token}"
    return render_template("start.html", claim_link=claim_link)


@app.get("/claim/<token>")
def claim(token: str):
    """
    Claim ownership using a token link.

    Overwrites any existing owner cookie with the token from the link.

    Args:
        token: Authentication token from claim link

    Returns:
        Redirect to home page with cookie set, or error if token invalid
    """
    owner_id = owner_service.get_owner_id_by_token(token)
    if not owner_id:
        return "Ungültiger Link", 400

    resp = make_response(redirect("/"))
    # Delete any existing cookie first to ensure clean overwrite
    resp.delete_cookie("owner_token")
    # Use secure=False for development, secure=True in production with HTTPS
    _set_owner_cookie(resp, token, secure=False)
    return resp



@app.get("/")
def home():
    """
    Home page displaying list of user's dashboards.

    Automatically creates an owner account if user doesn't have one.
    """
    token = request.cookies.get("owner_token")
    owner_id = owner_service.get_owner_id_by_token(token) if token else None

    # Auto-create owner if new user
    if not owner_id:
        owner_id, token = owner_service.create_owner()
        resp = make_response(redirect("/"))
        # Use secure=False for development, secure=True in production with HTTPS
        _set_owner_cookie(resp, token, secure=False)
        return resp

    dashboards = dashboard_service.list_dashboards(owner_id)
    return render_template("index.html", dashboards=dashboards)



# ============================================================================
# Dashboard Management Routes
# ============================================================================


@app.get("/dashboard/new")
def dashboard_new():
    """
    Create a new dashboard and redirect to editor.

    Returns:
        Redirect to edit page for new dashboard, or to start page if not authenticated
    """
    owner_id = require_owner_id_ui()
    if not owner_id:
        return redirect("/start")
    new_id = dashboard_service.create_dashboard(owner_id, name="Neues Dashboard")
    return redirect(f"/dashboard/{new_id}/edit")


@app.get("/dashboard/<dash_id>/edit")
def dashboard_edit(dash_id: str):
    """
    Display dashboard editor page.

    Args:
        dash_id: Dashboard ID

    Returns:
        Dashboard editor template, or 404 if not found, or redirect if not authenticated
    """
    owner_id = require_owner_id_ui()
    if not owner_id:
        return redirect("/start")
    dash = dashboard_service.get_dashboard(owner_id, dash_id)
    if not dash:
        abort(404)
    return render_template("dashboard.html", dashboard_id=dash_id)


@app.get("/dashboard/<dash_id>/view")
def dashboard_view(dash_id: str):
    """
    Display dashboard view page (read-only).

    Args:
        dash_id: Dashboard ID

    Returns:
        Dashboard view template, or 404 if not found, or redirect if not authenticated
    """
    owner_id = require_owner_id_ui()
    if not owner_id:
        return redirect("/start")
    dash = dashboard_service.get_dashboard(owner_id, dash_id)
    if not dash:
        abort(404)
    return render_template("dashboard_view.html", dashboard_id=dash_id)


@app.delete("/api/dashboards/<dashboard_id>")
def delete_dashboard(dashboard_id: str):
    """
    Delete a dashboard via API.

    Args:
        dashboard_id: Dashboard ID to delete

    Returns:
        JSON response with success status, or error if not found/failed
    """
    owner_id = require_owner_id_api()
    dash = dashboard_service.get_dashboard(owner_id, dashboard_id)
    if not dash:
        return jsonify({"error": "Dashboard not found"}), 404

    ok = dashboard_service.delete_dashboard(owner_id, dashboard_id)
    if not ok:
        return jsonify({"error": "delete failed"}), 500

    return jsonify({"ok": True})


@app.get("/access-link")
def access_link():
    """
    Display page with access link for claiming ownership on another device.

    Returns:
        Access link template, or redirects to home if not authenticated
    """
    token = request.cookies.get("owner_token")
    owner_id = owner_service.get_owner_id_by_token(token) if token else None
    if not owner_id:
        return redirect("/")  # Triggers auto-claim

    base = request.url_root.rstrip("/")
    full_link = f"{base}/claim/{token}"

    return render_template("access_link.html", full_link=full_link)



# ============================================================================
# API Routes
# ============================================================================


@app.get("/api/stations")
def api_stations():
    """
    Search for stations matching query string.

    Query Parameters:
        q: Search query string (minimum 2 characters)

    Returns:
        JSON array of station objects with "id" and "label" keys
    """
    q = request.args.get("q", "")
    return jsonify(stations_service.search(q, limit=DEFAULT_STATION_SEARCH_LIMIT))


@app.post("/api/departures")
def api_departures():
    """
    Fetch departure information for multiple stations.

    Request Body:
        {
            "stations": [
                {"id": "station_id", "limit": 20},
                ...
            ]
        }

    Returns:
        JSON array of departure data per station, or error if invalid request
    """
    payload = request.get_json(silent=True) or {}
    stations = payload.get("stations", [])
    if not isinstance(stations, list) or not stations:
        return jsonify({"error": "stations must be a non-empty list"}), 400
    results = asyncio.run(mvg_service.fetch_departures(stations))
    return jsonify(results)


@app.get("/api/dashboards/<dash_id>")
def api_get_dashboard(dash_id: str):
    """
    Retrieve dashboard data via API.

    Args:
        dash_id: Dashboard ID

    Returns:
        JSON object with dashboard data, or 404 if not found
    """
    owner_id = require_owner_id_api()
    dash = dashboard_service.get_dashboard(owner_id, dash_id)
    if not dash:
        return jsonify({"error": "not found"}), 404
    return jsonify({
        "id": dash["id"],
        "name": dash["name"],
        "config": dash["config"],
        "updated_at": dash["updated_at"],
    })


@app.put("/api/dashboards/<dash_id>")
def api_put_dashboard(dash_id: str):
    """
    Update dashboard data via API.

    Args:
        dash_id: Dashboard ID

    Request Body:
        {
            "name": "Dashboard Name",
            "config": {...}
        }

    Returns:
        JSON response with success status, or error if invalid/not found
    """
    owner_id = require_owner_id_api()

    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "Dashboard").strip()
    config = payload.get("config")
    if not isinstance(config, dict):
        return jsonify({"error": "config must be an object"}), 400

    config["name"] = name

    ok = dashboard_service.update_dashboard(owner_id, dash_id, name=name, config=config)
    if not ok:
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True})

# ============================================================================
# Utility Routes
# ============================================================================


@app.get("/logout")
def logout():
    """
    Log out user by deleting authentication cookie.

    Returns:
        Redirect to start page
    """
    resp = make_response(redirect("/start"))
    resp.delete_cookie("owner_token")
    return resp


@app.get("/impressum")
def impressum():
    """Display legal imprint page."""
    return render_template("impressum.html")


@app.get("/datenschutzerklaerung")
def datenschutz():
    """Display privacy policy page."""
    return render_template("datenschutzerklaerung.html")


@app.get("/nutzungsbedingungen")
def nutzungsbedingungen():
    """Display terms of service page."""
    return render_template("nutzungsbedingungen.html")



# ============================================================================
# Application Entry Point
# ============================================================================

if __name__ == "__main__":
    # Development server - use proper WSGI server in production
    app.run(host="0.0.0.0", port=8888, debug=True)
