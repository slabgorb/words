import { Router } from 'express';
import { attachIdentity, requireIdentity } from './identity.js';
import { listUsers, getUserById } from './users.js';
import {
  createGame, listGamesForUser, sideForUser, getGameById
} from './games.js';

export function buildRoutes({ db, dict, isProd, devUser }) {
  const r = Router();
  r.use(attachIdentity({ db, isProd, devUser }));

  r.get('/me', requireIdentity, (req, res) => {
    const games = listGamesForUser(db, req.user.id).map(g => {
      const otherId = g.playerAId === req.user.id ? g.playerBId : g.playerAId;
      const other = getUserById(db, otherId);
      const you = sideForUser(g, req.user.id);
      const yourScore = you === 'a' ? g.scoreA : g.scoreB;
      const theirScore = you === 'a' ? g.scoreB : g.scoreA;
      return {
        id: g.id,
        opponent: { id: other.id, friendlyName: other.friendlyName, color: other.color },
        status: g.status,
        yourTurn: g.status === 'active' && g.currentTurn === you,
        yourScore, theirScore,
        endedReason: g.endedReason,
        winnerSide: g.winnerSide,
        updatedAt: g.updatedAt
      };
    });
    res.json({
      user: { id: req.user.id, email: req.user.email, friendlyName: req.user.friendlyName, color: req.user.color },
      games
    });
  });

  r.get('/users', requireIdentity, (_req, res) => {
    res.json(listUsers(db).map(u => ({ id: u.id, friendlyName: u.friendlyName, color: u.color })));
  });

  r.post('/games', requireIdentity, (req, res) => {
    const { otherUserId } = req.body ?? {};
    if (typeof otherUserId !== 'number') return res.status(400).json({ error: 'bad-request' });
    if (otherUserId === req.user.id) return res.status(400).json({ error: 'self-pairing' });
    const other = getUserById(db, otherUserId);
    if (!other) return res.status(404).json({ error: 'unknown-user' });
    try {
      const g = createGame(db, req.user.id, otherUserId);
      res.status(201).json({ gameId: g.id });
    } catch (e) {
      const msg = String(e?.message ?? '');
      if (/UNIQUE|one_active_per_pair/i.test(msg)) {
        return res.status(409).json({ error: 'pair-active' });
      }
      throw e;
    }
  });

  // Game-scoped routes added in Task 7.

  return r;
}
