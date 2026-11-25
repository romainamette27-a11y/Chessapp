#!/usr/bin/env python3
"""Serveur local pour le répertoire d'ouvertures d'échecs.

Lancement :  python3 repertoire.py
Puis ouvrez http://localhost:8765 (le navigateur s'ouvre automatiquement).

Les données sont enregistrées dans repertoire.json (à côté de ce script),
avec une copie de sécurité quotidienne dans repertoire-sauvegarde.json.
Aucun paquet externe n'est nécessaire. Écoute limitée à 127.0.0.1.
"""

import argparse
import json
import os
import shutil
import sys
import time
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WWW_DIR = os.path.join(BASE_DIR, "www")
DATA_FILE = os.path.join(BASE_DIR, "repertoire.json")
BACKUP_FILE = os.path.join(BASE_DIR, "repertoire-sauvegarde.json")
BACKUP_INTERVAL = 24 * 3600

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}

DEFAULT_DATA = {
    "version": 1,
    "perspective": "w",
    "opponents": [],
    "root": {"fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "children": []},
}


def load_data():
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, dict) or "root" not in data:
                raise ValueError("structure inattendue")
            return data
    except FileNotFoundError:
        return json.loads(json.dumps(DEFAULT_DATA))
    except (ValueError, OSError) as exc:
        print(f"Avertissement : repertoire.json illisible ({exc}), données neuves créées.", file=sys.stderr)
        return json.loads(json.dumps(DEFAULT_DATA))


def save_data(data):
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, DATA_FILE)
    _daily_backup()


def _daily_backup():
    try:
        if not os.path.exists(BACKUP_FILE) or time.time() - os.path.getmtime(BACKUP_FILE) > BACKUP_INTERVAL:
            shutil.copy2(DATA_FILE, BACKUP_FILE)
    except OSError:
        pass


class Handler(BaseHTTPRequestHandler):
    server_version = "RepertoireEchecs/1.0"

    def do_GET(self):
        if self.path in ("/api/data", "/api/data/"):
            body = json.dumps(load_data(), ensure_ascii=False).encode("utf-8")
            self._send(200, body, "application/json; charset=utf-8")
            return
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if path == "/":
            path = "/index.html"
        file_path = self._safe_static(path)
        if file_path is None:
            self._send(404, b"Fichier introuvable", "text/plain; charset=utf-8")
            return
        try:
            with open(file_path, "rb") as f:
                body = f.read()
        except OSError:
            self._send(404, b"Fichier introuvable", "text/plain; charset=utf-8")
            return
        ext = os.path.splitext(file_path)[1]
        self._send(200, body, MIME_TYPES.get(ext, "application/octet-stream"))

    def do_PUT(self):
        if self.path not in ("/api/data", "/api/data/"):
            self._send(404, b"Introuvable", "text/plain; charset=utf-8")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 20 * 1024 * 1024:
            self._send(400, b"Corps de requete invalide", "text/plain; charset=utf-8")
            return
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
            if not isinstance(data, dict) or "root" not in data:
                raise ValueError("structure inattendue")
        except (ValueError, UnicodeDecodeError) as exc:
            self._send(400, f"JSON invalide : {exc}".encode("utf-8"), "text/plain; charset=utf-8")
            return
        try:
            save_data(data)
        except OSError as exc:
            self._send(500, f"Écriture impossible : {exc}".encode("utf-8"), "text/plain; charset=utf-8")
            return
        self._send(200, b'{"ok": true}', "application/json; charset=utf-8")

    def _safe_static(self, path):
        candidate = os.path.realpath(os.path.join(WWW_DIR, path.lstrip("/")))
        if not candidate.startswith(os.path.realpath(WWW_DIR) + os.sep):
            return None
        return candidate if os.path.isfile(candidate) else None

    def _send(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(fmt % args)


def main():
    parser = argparse.ArgumentParser(description="Répertoire d'ouvertures d'échecs")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-open", action="store_true", help="ne pas ouvrir le navigateur")
    args = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://localhost:{args.port}"
    print(f"Répertoire d'échecs démarré sur {url}")
    print(f"Données : {DATA_FILE}")
    print("Arrêtez avec Ctrl+C.")
    if not args.no_open:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt du serveur.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
