# Game documentation

One page per shipped game, sourced from canonical published rulesets and verified against the engine code in `plugins/<id>/`.

Each page uses the same structure:

1. **Lineage** — what published ruleset the implementation follows.
2. **Components** — pieces, cards, board.
3. **Setup** — initial deal/placement.
4. **Turn structure** — actions, phases, validation.
5. **Scoring** — points, multipliers, bonuses.
6. **End conditions** — win/match-end triggers.
7. **Implementation** — file map, action types, state shape, aux routes.
8. **Alignment notes** — known deviations from the canonical rules (usually small: coin-flip openers, default match length, omitted variant rules).

## Games

| Game | Variant | Match | Doc |
|---|---|---|---|
| Words | Words With Friends (default) or Scrabble | board-clearing or scoreless deadlock | [words.md](words.md) |
| Rummikub | 1998 Pressman American Edition | first to empty rack | [rummikub.md](rummikub.md) |
| Cribbage | Standard 6-card 2-player | first to 121 | [cribbage.md](cribbage.md) |
| Backgammon | Standard match play, doubling cube, Crawford | first to N points (default 3) | [backgammon.md](backgammon.md) |
| Buraco | Buraco Brasileiro, 2-player | first to 3000 | [buraco.md](buraco.md) |

## Sources

- Words With Friends — [Wikipedia](https://en.wikipedia.org/wiki/Words_with_Friends)
- Rummikub — [Wikipedia (1998 Pressman American Edition)](https://en.wikipedia.org/wiki/Rummikub)
- Cribbage — [pagat.com — Six-Card Cribbage](https://www.pagat.com/adders/crib6.html)
- Backgammon — [bkgm.com — Rules of Backgammon](https://www.bkgm.com/rules.html)
- Buraco — [pagat.com — Buraco](https://www.pagat.com/rummy/buraco.html)

## Adding a new game

When adding a plugin, write a matching page here using the same eight-section format. The "Alignment notes" section is where you record every place the engine diverges from the published rules — even small ones (coin flips, omitted multipliers, simplified end-game rules). Future-you will thank you.

See the [root README](../../README.md) for the plugin contract and host architecture.
