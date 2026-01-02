"""Service for searching and managing public transportation stations from CSV data."""
import csv
from typing import List, Dict


class StationsService:
    """Service for searching stations loaded from a CSV file."""

    # CSV column names expected in the stations file
    COLUMN_NAME = "Name ohne Ort"
    COLUMN_CITY = "Ort"
    COLUMN_GLOBAL_ID = "Globale ID"

    def __init__(self, csv_path: str) -> None:
        """
        Initialize the stations service by loading data from CSV file.

        Args:
            csv_path: Path to the CSV file containing station data
        """
        with open(csv_path, newline="", encoding="utf-8-sig") as f:
            # Read sample to detect delimiter (tab, semicolon, or comma)
            sample = f.read(4096)
            f.seek(0)

            try:
                dialect = csv.Sniffer().sniff(sample, delimiters="\t,;")
            except csv.Error:
                dialect = csv.excel_tab  # fallback to tab-delimited

            reader = csv.DictReader(f, dialect=dialect)

            # Trim header whitespace (handles cases like "Globale ID " with trailing space)
            if reader.fieldnames:
                reader.fieldnames = [h.strip() for h in reader.fieldnames]

            self.rows = []
            for row in reader:
                clean = {
                    (k.strip() if isinstance(k, str) else k): (
                        v.strip() if isinstance(v, str) else v
                    )
                    for k, v in row.items()
                }
                self.rows.append(clean)

    def search(self, q: str, limit: int = 10) -> List[Dict[str, str]]:
        """
        Search for stations matching the query string.

        Args:
            q: Search query (minimum 2 characters)
            limit: Maximum number of results to return (default: 10)

        Returns:
            List of dictionaries with "id" and "label" keys
        """
        q = (q or "").strip().lower()
        if len(q) < 2:
            return []

        out = []
        for r in self.rows:
            name = (r.get(self.COLUMN_NAME) or "")
            city = (r.get(self.COLUMN_CITY) or "")
            gid = (r.get(self.COLUMN_GLOBAL_ID) or "")

            if not gid or not name:
                continue

            label = f"{name} ({city})" if city else name
            hay = f"{name} {city}".lower()

            if q in hay:
                out.append({"id": gid, "label": label})
                if len(out) >= limit:
                    break

        return out
