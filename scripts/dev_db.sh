#!/usr/bin/env bash
# Start a private Postgres for local development (data in ../.pgdata, port 5544).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN=/usr/lib/postgresql/16/bin
DATA="$ROOT/.pgdata"
PORT="${DEV_PG_PORT:-5544}"

if [ ! -f "$DATA/PG_VERSION" ]; then
  "$PGBIN/initdb" -D "$DATA" -U dubbing --auth=trust >/dev/null
  echo "unix_socket_directories = '$DATA'" >> "$DATA/postgresql.conf"
  echo "listen_addresses = 'localhost'" >> "$DATA/postgresql.conf"
  echo "port = $PORT" >> "$DATA/postgresql.conf"
fi

if ! "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  "$PGBIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" start >/dev/null
fi

psql -h localhost -p "$PORT" -U dubbing -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='dubbing_qc'" | grep -q 1 \
  || psql -h localhost -p "$PORT" -U dubbing -d postgres -c "CREATE DATABASE dubbing_qc" >/dev/null

echo "DATABASE_URL=postgres://dubbing@localhost:$PORT/dubbing_qc"
