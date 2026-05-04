# Words

A two-player Words with Friends clone for personal use. Self-hosted, ad-free.

## Setup

```bash
npm install
npm run fetch-dict
```

This downloads ENABLE2K (~3 MB) into `data/enable2k.txt`.

## Run

```bash
npm start
# defaults: PORT=3000, DB_PATH=./game.db, SECRET_PATH=./.secret
```

Open `http://localhost:3000`, pick "I'm Keith" or "I'm Sonia". Share the URL with your partner (Cloudflare tunnel, Tailscale, LAN, etc.) — the second browser picks the other identity.

## Test

```bash
npm test
```

## Files

- `data/enable2k.txt` — word list (gitignored; fetch with `npm run fetch-dict`)
- `game.db` — active game state (gitignored; safe to delete to reset)
- `.secret` — cookie signing key (gitignored; regenerated on next start if removed)

## Backups

```bash
cp game.db game.db.backup
```

## Reference

- Spec: `docs/superpowers/specs/2026-05-04-words-with-friends-design.md`
- Plan: `docs/superpowers/plans/2026-05-04-words-with-friends-implementation.md`
