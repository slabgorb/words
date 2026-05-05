# words — project tasks
# Framework recipes imported from .pennyfarthing/justfile.pf

import '.pennyfarthing/justfile.pf'

root := justfile_directory()

# Service identity
server_label   := "com.slabgorb.words-server"
tunnel_label   := "com.slabgorb.words-tunnel"
server_plist   := home_directory() / "Library/LaunchAgents" / (server_label + ".plist")
tunnel_plist   := home_directory() / "Library/LaunchAgents" / (tunnel_label + ".plist")
server_log     := home_directory() / "Library/Logs/words-server.log"
tunnel_log     := home_directory() / "Library/Logs/words-tunnel.log"
public_url     := "https://words.slabgorb.com"
local_url      := "http://localhost:3000"

default:
    @just --list

# --- Development ---

# Run the server in the foreground (kills the launchd-managed copy first)
dev: down-server
    npm start

# Run the test suite
test:
    npm test

# --- Service control ---

# Bring up both services (server + tunnel) under launchd
up: up-server up-tunnel
    @sleep 2
    @echo ""
    @just status

# Bring down both services
down: down-tunnel down-server

# Restart both services
restart: down up

# Bring up just the local server (idempotent)
up-server:
    @launchctl load -w {{ server_plist }} >/dev/null 2>&1 || true
    @echo "server: loaded"

# Stop the local server (idempotent)
down-server:
    @launchctl unload {{ server_plist }} >/dev/null 2>&1 || true
    @echo "server: unloaded"

# Bring up just the tunnel (idempotent)
up-tunnel:
    @launchctl load -w {{ tunnel_plist }} >/dev/null 2>&1 || true
    @echo "tunnel: loaded"

# Stop just the tunnel (idempotent)
down-tunnel:
    @launchctl unload {{ tunnel_plist }} >/dev/null 2>&1 || true
    @echo "tunnel: unloaded"

# --- Status & diagnostics ---

# Show running state + reachability of both services
status:
    @printf '%-30s %s\n' 'service' 'launchd state'
    @printf '%-30s %s\n' '------------------------------' '-------------'
    @printf '%-30s ' '{{ server_label }}'; launchctl list | awk '$3=="{{ server_label }}" {printf "pid=%s exit=%s\n", $1, $2; found=1} END {if(!found) print "not loaded"}'
    @printf '%-30s ' '{{ tunnel_label }}'; launchctl list | awk '$3=="{{ tunnel_label }}" {printf "pid=%s exit=%s\n", $1, $2; found=1} END {if(!found) print "not loaded"}'
    @echo ""
    @printf 'local  ({{ local_url }}/api/state)  '
    @curl -s -o /dev/null -w 'HTTP %{http_code}\n' --max-time 4 {{ local_url }}/api/state || echo 'UNREACHABLE'
    @printf 'public ({{ public_url }}/api/state) '
    @curl -s -o /dev/null -w 'HTTP %{http_code}\n' --max-time 8 {{ public_url }}/api/state || echo 'UNREACHABLE'

# Tail both log streams
logs:
    @echo "=== tail -f {{ server_log }} (and tunnel log)" && \
    tail -F {{ server_log }} {{ tunnel_log }}

# Tail just the server log
logs-server:
    @tail -F {{ server_log }}

# Tail just the tunnel log
logs-tunnel:
    @tail -F {{ tunnel_log }}

# --- Install / uninstall ---

# Materialize LaunchAgent plists from infra/launchd templates into ~/Library/LaunchAgents
# Substitutes __HOME__ and __PROJECT_DIR__. Idempotent — overwrites installed copies.
install:
    @mkdir -p {{ home_directory() }}/Library/LaunchAgents {{ home_directory() }}/Library/Logs
    @test -f {{ root }}/infra/launchd/{{ server_label }}.plist || (echo "missing template: infra/launchd/{{ server_label }}.plist" && exit 1)
    @test -f {{ root }}/infra/launchd/{{ tunnel_label }}.plist || (echo "missing template: infra/launchd/{{ tunnel_label }}.plist" && exit 1)
    @sed -e 's|__HOME__|{{ home_directory() }}|g' -e 's|__PROJECT_DIR__|{{ root }}|g' \
        {{ root }}/infra/launchd/{{ server_label }}.plist > {{ server_plist }}
    @sed -e 's|__HOME__|{{ home_directory() }}|g' -e 's|__PROJECT_DIR__|{{ root }}|g' \
        {{ root }}/infra/launchd/{{ tunnel_label }}.plist > {{ tunnel_plist }}
    @plutil -lint {{ server_plist }} > /dev/null
    @plutil -lint {{ tunnel_plist }} > /dev/null
    @echo "installed: {{ server_plist }}"
    @echo "installed: {{ tunnel_plist }}"
    @echo "next: cp infra/cloudflared/words-config.yml.example ~/.cloudflared/words-config.yml (one-time, see infra/README.md)"

# Stop both services and remove their LaunchAgent plists
uninstall: down
    @rm -f {{ server_plist }} {{ tunnel_plist }}
    @echo "uninstalled (logs at {{ server_log }} and {{ tunnel_log }} kept)"

# --- Maintenance ---

# Back up game.db with a timestamped suffix
backup:
    @cp {{ root }}/game.db {{ root }}/game.db.$(date +%Y%m%d-%H%M%S).backup
    @ls -lh {{ root }}/game.db.*.backup | tail -3

# Reset the active game (DESTRUCTIVE — archives via in-app new-game instead if possible)
reset-game: down-server
    @rm -f {{ root }}/game.db {{ root }}/game.db-shm {{ root }}/game.db-wal
    @echo "game.db cleared"
    @just up-server

# Roster management

# Add a user to the roster.
add-user EMAIL NAME:
    node bin/add-user.js {{EMAIL}} "{{NAME}}"

# List all roster users.
list-users:
    node bin/list-users.js

# Rename a roster user.
rename-user EMAIL NAME:
    node bin/rename-user.js {{EMAIL}} "{{NAME}}"
