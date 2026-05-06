import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { getGameById } from './games.js';
import { getUserById } from './users.js';

export function mountPluginClients(app, { db, registry }) {
  for (const plugin of Object.values(registry)) {
    const base = `/play/${plugin.id}`;

    // Per-plugin middleware: validate game_type and membership.
    // Identity middleware (req.user) runs before this.
    app.use(`${base}/:gameId`, (req, res, next) => {
      const id = Number(req.params.gameId);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).end();
      const game = getGameById(db, id);
      if (!game) return res.status(404).end();
      if (game.gameType !== plugin.id) return res.status(404).end();
      if (req.user.id !== game.playerAId && req.user.id !== game.playerBId) {
        return res.status(403).end();
      }
      req.game = game;
      next();
    });

    // Bare directory + trailing-slash variants for index.html with injection
    app.get(`${base}/:gameId`, (req, res, next) => {
      if (!req.path.endsWith('/')) return res.redirect(301, req.path + '/');
      return serveIndex(plugin.clientDir, db, req, res);
    });
    app.get(`${base}/:gameId/`, (req, res) => serveIndex(plugin.clientDir, db, req, res));
    app.get(`${base}/:gameId/index.html`, (req, res) => serveIndex(plugin.clientDir, db, req, res));

    // Static assets (everything else under the path)
    app.use(`${base}/:gameId`, express.static(plugin.clientDir, { index: false }));
  }
}

function serveIndex(clientDir, db, req, res) {
  const indexPath = path.join(clientDir, 'index.html');
  let html;
  try { html = fs.readFileSync(indexPath, 'utf8'); }
  catch { return res.status(500).end('plugin index.html missing'); }

  const opponentId = req.game.playerAId === req.user.id ? req.game.playerBId : req.game.playerAId;
  const opponent = getUserById(db, opponentId);

  const ctx = {
    gameId: req.game.id,
    userId: req.user.id,
    gameType: req.game.gameType,
    sseUrl: `/api/games/${req.game.id}/events`,
    actionUrl: `/api/games/${req.game.id}/action`,
    stateUrl: `/api/games/${req.game.id}`,
    yourFriendlyName: req.user.friendlyName,
    opponentFriendlyName: opponent?.friendlyName ?? 'Opponent',
  };
  const inject = `<script>window.__GAME__ = ${JSON.stringify(ctx)};</script>`;

  let injected;
  if (/<\/head>/i.test(html)) {
    injected = html.replace(/<\/head>/i, inject + '</head>');
  } else if (/<body[^>]*>/i.test(html)) {
    injected = html.replace(/<body[^>]*>/i, m => inject + m);
  } else {
    injected = inject + html;
  }
  // Per-game HTML carries an injected window.__GAME__ context (game id,
  // user id, urls). Caching it would let a stale gameId surface in a
  // browser tab the user revisits, and any future client-asset path
  // change would persist for cached tabs until manual hard-reload.
  res.set('Cache-Control', 'no-store');
  res.type('html').send(injected);
}
