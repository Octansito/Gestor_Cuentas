"""
Servidor de desarrollo para la app. Sin dependencias.

Frente a `python -m http.server`, este añade dos cosas necesarias aquí:

  1. `Cache-Control: no-store`. http.server no manda cabeceras de caché, así que
     el navegador aplica "frescura heurística" y se queda con módulos viejos:
     editas un .js, recargas y no ves el cambio.
  2. El tipo MIME correcto para .webmanifest y .svg.

Uso:
    python tools/serve.py            # http://localhost:5178
    python tools/serve.py 8080       # otro puerto

Para abrirlo desde el móvil, en la misma wifi, usa la IP que imprime al arrancar.
Ojo: en http:// (no https) el navegador no instala la PWA ni activa el modo
offline; para eso hace falta https o localhost. Mira el README.
"""

import socket
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".js": "text/javascript",
        ".json": "application/json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        # El service worker solo puede controlar rutas dentro de su ámbito;
        # sirviendo desde la raíz no hace falta nada más.
        super().end_headers()

    def log_message(self, fmt, *args):
        # Silencia el ruido de cada petición; deja pasar los errores.
        if not str(args[1] if len(args) > 1 else "").startswith("2"):
            super().log_message(fmt, *args)


def lan_ip():
    """IP de esta máquina en la red local, para abrir la app desde el móvil."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no envía nada; solo elige la interfaz
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5178
    handler = partial(Handler, directory=str(ROOT))
    server = ThreadingHTTPServer(("0.0.0.0", port), handler)

    print(f"Gestor de Cuentas sirviéndose desde {ROOT}")
    print(f"  Este equipo:  http://localhost:{port}")
    print(f"  Red local:    http://{lan_ip()}:{port}   (para probar desde el móvil)")
    print("Ctrl+C para parar.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nParado.")
