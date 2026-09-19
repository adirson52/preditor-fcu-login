"""Read-only verification of a downloaded QA GeoPackage against its GeoJSON."""
import argparse
import json
import math
from pathlib import Path
import sqlite3
import struct


def polygon(blob):
    assert blob[:2] == b"GP", "Missing GeoPackage geometry header"
    endian = "<" if blob[3] & 1 else ">"
    assert struct.unpack_from(endian + "i", blob, 4)[0] == 4326, "Unexpected SRS"
    envelope = (blob[3] >> 1) & 7
    offset = 8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope]
    endian = "<" if blob[offset] else ">"
    geometry_type, ring_count = struct.unpack_from(endian + "II", blob, offset + 1)
    assert geometry_type == 3, "Export must contain Polygon WKB"
    offset += 9
    rings = []
    for _ in range(ring_count):
        count = struct.unpack_from(endian + "I", blob, offset)[0]
        offset += 4
        ring = []
        for _ in range(count):
            x, y = struct.unpack_from(endian + "dd", blob, offset)
            assert math.isfinite(x) and math.isfinite(y), "Non-finite coordinate"
            assert -180 <= x <= 180 and -90 <= y <= 90, "Coordinate order/SRS invalid"
            ring.append([x, y])
            offset += 16
        assert count >= 4 and ring[0] == ring[-1], "Polygon ring not closed"
        rings.append(ring)
    assert offset == len(blob), "Unexpected trailing geometry bytes"
    return rings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("gpkg", type=Path)
    parser.add_argument("geojson", type=Path)
    args = parser.parse_args()
    features = json.loads(args.geojson.read_text(encoding="utf-8"))["features"]
    expected = {str(f["id"]): f for f in features}
    assert len(expected) == len(features), "Duplicate GeoJSON feature identifiers"
    metadata_checked = False
    with sqlite3.connect(args.gpkg.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        assert connection.execute("pragma integrity_check").fetchone()[0] == "ok", "SQLite integrity failure"
        table, column, kind, srs = connection.execute("select table_name,column_name,geometry_type_name,srs_id from gpkg_geometry_columns").fetchone()
        assert table == "percepcoes_fcu" and column == "geom" and kind == "POLYGON" and srs == 4326, "Unexpected geometry metadata"
        columns = {row[1] for row in connection.execute('pragma table_info("percepcoes_fcu")')}
        complete_metadata = {"perception_id", "versao", "metadados_json"}.issubset(columns)
        sql = 'select id,geom,perception_id,versao,metadados_json from "percepcoes_fcu"' if complete_metadata else 'select id,geom from "percepcoes_fcu"'
        rows = connection.execute(sql).fetchall()
        assert len(rows) == len(expected), "Feature count mismatch"
        seen = set()
        for row in rows:
            identifier, blob = row[:2]
            if complete_metadata:
                perception_id, version, metadata = row[2:]
                identifier = f"{perception_id}:{version}" if version is not None else str(identifier)
                assert json.loads(metadata) == expected[identifier]["properties"], "Snapshot metadata mismatch"
                metadata_checked = True
            identifier = str(identifier)
            assert identifier not in seen, "Duplicate GeoPackage feature identifiers"
            seen.add(identifier)
            assert identifier in expected, "Unexpected feature in GeoPackage"
            actual = polygon(blob)
            reference = expected[identifier]["geometry"]["coordinates"]
            assert len(actual) == len(reference), "Ring count mismatch"
            for ring, expected_ring in zip(actual, reference):
                assert len(ring) == len(expected_ring), "Vertex count mismatch"
                for point, expected_point in zip(ring, expected_ring):
                    assert all(abs(a - b) <= 1e-10 for a, b in zip(point, expected_point)), "Coordinate mismatch"
    print(json.dumps({"status": "passed", "features": len(rows), "srs": 4326, "geometry": "Polygon", "integrity": "ok", "geometryMatchesGeoJSON": True, "allSnapshotMetadataMatchesGeoJSON": metadata_checked}))


if __name__ == "__main__":
    main()
