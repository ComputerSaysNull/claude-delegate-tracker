#!/usr/bin/env bash
# Starts the tracker at boot as a systemd user unit, using this repo's .env.
#   scripts/autostart.sh            install (or replace) the unit and start it
#   scripts/autostart.sh --stop     stop the tracker it started
#   scripts/autostart.sh --remove   stop it and remove the unit
set -euo pipefail

unit="claude-delegate-tracker.service"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit_file="$unit_dir/$unit"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "${1:-}" in
  --stop)
    systemctl --user stop "$unit"
    echo "Stopped the tracker '$unit' started."
    exit 0
    ;;
  --remove)
    systemctl --user disable --now "$unit" 2>/dev/null || true
    rm -f "$unit_file"
    systemctl --user daemon-reload
    echo "Stopped the tracker and removed the '$unit' unit."
    exit 0
    ;;
  "") ;;
  *)
    echo "usage: $0 [--stop|--remove]" >&2
    exit 2
    ;;
esac

# A user unit does not see the login shell's PATH, so it gets absolute paths.
npm="$(command -v npm)" || { echo "npm not found on PATH" >&2; exit 1; }
node="$(command -v node)" || { echo "node not found on PATH" >&2; exit 1; }
# npm runs "#!/usr/bin/env node", so the unit's PATH must reach node too.
node_dir="$(dirname "$node")"

mkdir -p "$unit_dir"
# Settings come from the repo's .env, which the server reads itself.
cat > "$unit_file" <<UNIT
[Unit]
Description=Delegation tracker
# A failing build would otherwise retry forever: 3 tries in 5 minutes, then it stays down.
StartLimitIntervalSec=300
StartLimitBurst=3

[Service]
WorkingDirectory=$repo
Environment=PATH=$node_dir:/usr/local/bin:/usr/bin:/bin
ExecStartPre=$npm run build
ExecStart=$node src/server/main.ts
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable "$unit"
systemctl --user restart "$unit"
echo "Installed and started '$unit'. Logs: journalctl --user -u $unit"

# Without linger, a user unit starts at your login, not at boot.
if loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q '^Linger=no'; then
  echo "To start it at boot without a login, run: loginctl enable-linger \"$USER\""
fi
