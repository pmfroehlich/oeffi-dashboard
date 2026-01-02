"""Service for fetching public transportation departure data from MVG API."""
import asyncio
import aiohttp
from typing import List, Dict, Any
from mvg import MvgApi


class MvgService:
    """Service for fetching real-time departure information from MVG API."""

    # ========================================================================
    # Private Methods
    # ========================================================================

    async def _fetch_one(
        self, session: aiohttp.ClientSession, station_id: str, limit: int
    ) -> Dict[str, Any]:
        """
        Fetch departures for a single station.

        Args:
            session: aiohttp client session for making requests
            station_id: The station ID
            limit: Maximum number of departures to return

        Returns:
            Dictionary with station_id, departures list, and optional error
        """
        try:
            deps = await MvgApi.departures_async(
                station_id, session=session, limit=limit
            )
            tidy = []
            for d in deps[:limit]:
                tidy.append({
                    "line": d.get("line"),
                    "destination": d.get("destination"),
                    "planned": d.get("planned"),
                    "time": d.get("time"),
                    "delay": d.get("delay"),
                    "platform": d.get("platform"),
                    "type": d.get("type"),
                })
            return {"station_id": station_id, "departures": tidy, "error": None}
        except Exception as e:
            return {"station_id": station_id, "departures": [], "error": str(e)}

    # ========================================================================
    # Public Methods
    # ========================================================================

    async def fetch_departures(
        self, stations: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Fetch departures for multiple stations concurrently.

        Args:
            stations: List of station dictionaries, each containing:
                - "id": Station ID (required)
                - "limit": Maximum departures to fetch (optional, defaults to 20)

        Returns:
            List of dictionaries, each containing station_id, departures, and optional error
        """
        async with aiohttp.ClientSession() as session:
            tasks = []
            for s in stations:
                station_id = s.get("id")
                limit = int(s.get("limit") or 20)
                if station_id:
                    tasks.append(self._fetch_one(session, station_id, limit))
            return await asyncio.gather(*tasks)
