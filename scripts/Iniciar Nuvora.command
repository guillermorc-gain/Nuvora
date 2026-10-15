#!/bin/bash
# Nuvora para Mac y Linux: doble clic para arrancar el servidor.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Nuvora necesita Node.js 22 o superior: https://nodejs.org/es/download"
  open "https://nodejs.org/es/download" 2>/dev/null || xdg-open "https://nodejs.org/es/download" 2>/dev/null
  read -r -p "Pulsa Intro para cerrar"
  exit 1
fi
echo "Abriendo Nuvora... Deja esta ventana abierta mientras lo uses."
(sleep 2; open "http://localhost:3000" 2>/dev/null || xdg-open "http://localhost:3000" 2>/dev/null) &
exec node --disable-warning=ExperimentalWarning server/index.js
