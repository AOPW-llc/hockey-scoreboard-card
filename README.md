# Hockey Scoreboard Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![Validate](https://github.com/AOPW-llc/hockey-scoreboard-card/actions/workflows/validate.yml/badge.svg)](https://github.com/AOPW-llc/hockey-scoreboard-card/actions/workflows/validate.yml)

A Home Assistant dashboard card for NHL scores. It shows one week at a time
(Monday to Sunday), with one column per day. Each column has a dropdown of that
day's games and shows the selected game's score by period, team stats, leaders,
three stars, scoring summary and division standings. Tap a team logo for that
team's season stats against the league leaders and the full East / West
standings.

No integration, sensor or API key is needed. The card reads ESPN's public
scoreboard, game summary, standings and team statistics feeds straight from the
browser.

## Features

- **Weeks.** Each screen is one Monday–Sunday week. Preseason and playoff weeks
  are named in the header.
- **Carousel.** The arrows move a week back or forward with a sliding
  carousel. Within the week, swipe or scroll through the days, or tap a day
  button (M T W T F S S) to jump to it.
- **Fits the screen.** By default the card shows as many whole days as fit
  across it, so no column is cut off. On a phone that's one day at a time. Or
  choose how many days to show (1–7).
- **Game dropdown per day.**
  - Started or finished: `Boston (3) - Toronto (2) Final/OT` or
    `Boston (1) - Toronto (1) 12:34/2nd`
  - Not started: `Chicago v. Boston, 1:00 PM`
  - The two New York teams show as `NY Rangers` and `NY Islanders`.
- **Game view.**
  - Both teams with logos, records (W-L-OT, and home or away) and the score.
  - Goals by period, including overtime and the shootout.
  - Team stats side by side once the game has started (shots, power play,
    faceoffs, hits, blocked shots, takeaways, giveaways, penalty minutes), with
    the better number highlighted.
  - Goals, assists and points leaders.
  - The three stars once the game is final.
  - Scoring summary by period: time, team, scorer with season goal count,
    assists, and power-play / short-handed / empty-net tags.
  - Tap the **Team stats**, **Leaders** or **Scoring** heading to hide that
    section in every day column, and tap it again to bring it back. The browser
    remembers your choice.
  - The top 3 in each team's division with records and points.
  - Before the game: puck drop, venue, TV and (optionally) the betting line.
  - Playoff series and special games (e.g. outdoor games) are named above the
    matchup.
- **Team view.** Tap a team logo to see:
  - The team's season stats against the league leader in each, with its league
    rank.
  - East and West standings by division with W-L-OT and points. Tap any team
    to switch to it.
- **Picks up where you left off.** Leave the dashboard and come back, and the
  card returns to the week, day and team page you were on. It starts fresh at
  today in a new tab or app session, or once the date has changed.
- **Live updates.** Refreshes every 30 seconds while a game is on (or about to
  start), and every 5 minutes otherwise.
- **Favorite team.** Optionally picks your team's game automatically on the
  days they play.

## Installation

### HACS (recommended)

1. In HACS, open the menu (⋮) → **Custom repositories**.
2. Add `https://github.com/AOPW-llc/hockey-scoreboard-card` with category
   **Dashboard**.
3. Search for **Hockey Scoreboard Card**, download it, and reload your browser.

### Manual

1. Download `hockey-scoreboard-card.js` from the
   [latest release](https://github.com/AOPW-llc/hockey-scoreboard-card/releases/latest).
2. Copy it to `/config/www/hockey-scoreboard-card.js`.
3. Go to **Settings → Dashboards → ⋮ → Resources** and add
   `/local/hockey-scoreboard-card.js` as a **JavaScript module**.

## Configuration

Add the card from the dashboard card picker (search "Hockey"). Everything can
be set in the visual editor. The card works best full width, for example in a
**Panel** view.

```yaml
type: custom:hockey-scoreboard-card
team: BOS
days: auto
refresh_interval: 30
show_odds: true
```

| Option | Default | Description |
|---|---|---|
| `team` | none | Favorite team's abbreviation (e.g. `BOS`, `TOR`, `NYR`). Its game is selected automatically on the days it plays. |
| `days` | `auto` | How many days of the week show at once (`auto` or `1`–`7`). The rest of the week is a swipe or scroll away, and the arrows always move a whole week. |
| `refresh_interval` | `30` | Seconds between refreshes while a game is live (10–300). |
| `show_odds` | `true` | Show the betting line before the game. |

With `days: auto` the card shows as many columns at least 300px wide as fit
(one day below 600px wide). It measures its own width, not the device's, so a
**Panel** view gives it the most room.

## Stats shown

**Game stats:** shots, power play, faceoff %, hits, blocked shots, takeaways,
giveaways, penalty minutes.

**Season stats in the team view:** goals per game, goals against per game,
shots per game, shots against per game, power play %, penalty kill %, shooting
%, save %, shutouts, penalty minutes per game.

## Notes

- Times are shown in your browser's time zone. A game belongs to the day it
  starts locally.
- Division standings are in ESPN's order.
- ESPN's feeds are public but undocumented, and can change without notice.

## Disclaimer

This is an unofficial, fan-made card. It is not affiliated with, endorsed by or
sponsored by the NHL, its teams or ESPN. Team names and logos are trademarks of
their respective owners. Logos are loaded from ESPN at runtime and are not
included in this repository.

## License

[MIT](LICENSE)
