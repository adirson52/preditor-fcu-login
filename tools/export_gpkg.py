import sys
import json
import urllib.request
import sqlite3

def convert_geojson_to_gpkg(geojson_path_or_url, output_gpkg_path):
    print(f"Lendo dados de {geojson_path_or_url}...")
    
    if geojson_path_or_url.startswith("http://") or geojson_path_or_url.startswith("https://"):
        req = urllib.request.Request(geojson_path_or_url)
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode('utf-8'))
    else:
        with open(geojson_path_or_url, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
    features = data.get('features', [])
    print(f"Total de {len(features)} feições encontradas no GeoJSON.")
    
    # Criar um SQLite/GeoPackage básico
    conn = sqlite3.connect(output_gpkg_path)
    cursor = conn.cursor()
    
    # Configurar tabelas do padrão OGC GeoPackage
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS gpkg_spatial_ref_sys (
        srs_name TEXT NOT NULL,
        srs_id INTEGER NOT NULL PRIMARY KEY,
        organization TEXT NOT NULL,
        organization_coordsys_id INTEGER NOT NULL,
        definition TEXT NOT NULL,
        description TEXT
    );
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS gpkg_contents (
        table_name TEXT NOT NULL PRIMARY KEY,
        data_type TEXT NOT NULL,
        identifier TEXT UNIQUE,
        description TEXT DEFAULT '',
        last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE,
        srs_id INTEGER,
        CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
    );
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS gpkg_geometry_columns (
        table_name TEXT NOT NULL,
        column_name TEXT NOT NULL,
        geometry_type_name TEXT NOT NULL,
        srs_id INTEGER NOT NULL,
        z TINYINT NOT NULL,
        m TINYINT NOT NULL,
        CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
        CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
    );
    """)
    
    # Inserir WGS84 EPSG:4326 no GPKG
    cursor.execute("""
    INSERT OR IGNORE INTO gpkg_spatial_ref_sys VALUES (
        'WGS 84 geodetic', 4326, 'EPSG', 4326,
        'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]',
        'longitude/latitude coordinates in WGS84'
    );
    """)
    
    # Criar a tabela de percepções no GPKG
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS percepcoes (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        title TEXT,
        perceived_class TEXT,
        action_type TEXT,
        area_id TEXT,
        cell_id TEXT,
        intensity INTEGER,
        confidence TEXT,
        time_reference TEXT,
        description TEXT,
        created_at TEXT,
        geojson_geometry TEXT
    );
    """)
    
    cursor.execute("""
    INSERT OR REPLACE INTO gpkg_contents (table_name, data_type, identifier, description, srs_id)
    VALUES ('percepcoes', 'features', 'percepcoes', 'Camada de Percepções Territoriais FCU', 4326);
    """)
    
    for feat in features:
        props = feat.get('properties', {})
        geom_json = json.dumps(feat.get('geometry', {}))
        cursor.execute("""
        INSERT OR REPLACE INTO percepcoes (
            id, user_id, title, perceived_class, action_type, area_id, cell_id,
            intensity, confidence, time_reference, description, created_at, geojson_geometry
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            str(props.get('id', '')),
            str(props.get('user_id', '')),
            str(props.get('title', '')),
            str(props.get('perceived_class', '')),
            str(props.get('action_type', '')),
            str(props.get('area_id', '')),
            str(props.get('cell_id', '')),
            props.get('intensity', 3),
            str(props.get('confidence', '')),
            str(props.get('time_reference', '')),
            str(props.get('description', '')),
            str(props.get('created_at', '')),
            geom_json
        ))
        
    conn.commit()
    conn.close()
    print(f"Sucesso! GeoPackage criado em: {output_gpkg_path}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Uso: python export_gpkg.py <arquivo_entrada.geojson> <saida.gpkg>")
    else:
        convert_geojson_to_gpkg(sys.argv[1], sys.argv[2])
