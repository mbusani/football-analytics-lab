"""Build the training-ground database from StatsBomb's free World Cup 2022 data.

Downloads the match list, lineups and events from https://github.com/statsbomb/open-data
(competition 43, season 106) and writes a small SQLite file with three tables:

  matches  one row per match
  players  one row per player per team (from the lineups)
  shots    one row per shot, penalty shootouts included (period = 5)

Usage:  python training/data/build_wc2022.py
Output: training/data/wc2022.sqlite next to this script.

Data: StatsBomb open data, used under the StatsBomb Public Data User Agreement.
"""
import json
import sqlite3
import time
import urllib.request
from pathlib import Path

BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"
OUT = Path(__file__).with_name("wc2022.sqlite")

# Column names are kept short and lower-case so they're easy to type in the SQL drills.
# players is keyed on (player_id, team) in case a player ever appears for two teams.
SCHEMA = """
CREATE TABLE matches (
  match_id    INTEGER PRIMARY KEY,
  match_date  TEXT,
  kick_off    TEXT,
  stage       TEXT,
  match_week  INTEGER,
  home_team   TEXT,
  away_team   TEXT,
  home_score  INTEGER,
  away_score  INTEGER,
  stadium     TEXT,
  referee     TEXT
);
CREATE TABLE players (
  player_id     INTEGER,
  player_name   TEXT,
  nickname      TEXT,
  team          TEXT,
  jersey_number INTEGER,
  country       TEXT,
  PRIMARY KEY (player_id, team)
);
CREATE TABLE shots (
  shot_id        TEXT PRIMARY KEY,
  match_id       INTEGER REFERENCES matches(match_id),
  team           TEXT,
  player_id      INTEGER,
  player         TEXT,
  period         INTEGER,
  minute         INTEGER,
  second         INTEGER,
  x              REAL,
  y              REAL,
  xg             REAL,
  outcome        TEXT,
  shot_type      TEXT,
  body_part      TEXT,
  technique      TEXT,
  under_pressure INTEGER
);
"""


def get(path, tries=4):
    """Download one JSON file from the StatsBomb open-data repo and parse it.

    Event files are several MB each, so a stalled connection is retried rather than left to hang.
    """
    for attempt in range(1, tries + 1):
        try:
            with urllib.request.urlopen(f"{BASE}/{path}", timeout=60) as r:
                return json.load(r)
        except (OSError, json.JSONDecodeError) as e:
            if attempt == tries:
                raise
            print(f"  retrying {path} ({e})")
            time.sleep(2 * attempt)


def name(obj):
    """StatsBomb nests labels as {"id": …, "name": …}; return the name, or None if the field is missing."""
    return obj["name"] if obj else None


def main():
    # Competition 43 = FIFA World Cup, season 106 = 2022. Sort by kick-off so match rows are in date order.
    matches = get("matches/43/106.json")
    matches.sort(key=lambda m: (m["match_date"], m["kick_off"]))

    # Always start from an empty file so a rebuild never mixes old and new rows
    OUT.unlink(missing_ok=True)
    db = sqlite3.connect(OUT)
    db.executescript(SCHEMA)

    # Lineups repeat players across matches, so collect them once here and insert at the end
    players = {}
    for i, m in enumerate(matches, 1):
        mid = m["match_id"]
        print(f"[{i:2}/{len(matches)}] {m['home_team']['home_team_name']} v {m['away_team']['away_team_name']}")

        # matches: one row; kick_off trimmed from "15:00:00.000" to "15:00"
        db.execute(
            "INSERT INTO matches VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (mid, m["match_date"], m["kick_off"][:5], m["competition_stage"]["name"], m["match_week"],
             m["home_team"]["home_team_name"], m["away_team"]["away_team_name"],
             m["home_score"], m["away_score"], name(m.get("stadium")), name(m.get("referee"))),
        )

        # players: everyone named in either matchday squad
        for team in get(f"lineups/{mid}.json"):
            for p in team["lineup"]:
                players[(p["player_id"], team["team_name"])] = (
                    p["player_id"], p["player_name"], p["player_nickname"], team["team_name"],
                    p["jersey_number"], name(p.get("country")),
                )

        # shots: keep only Shot events from the full event stream (own goals are separate
        # event types, so they're not here). Location is [x, y] on a 120 x 80 pitch.
        for e in get(f"events/{mid}.json"):
            if e["type"]["name"] != "Shot":
                continue
            s = e["shot"]
            x, y = (e.get("location") or [None, None])[:2]
            db.execute(
                "INSERT INTO shots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (e["id"], mid, e["team"]["name"], e["player"]["id"], e["player"]["name"],
                 e["period"], e["minute"], e["second"], x, y, round(s["statsbomb_xg"], 4),
                 name(s.get("outcome")), name(s.get("type")), name(s.get("body_part")),
                 name(s.get("technique")), int(bool(e.get("under_pressure")))),
            )

    db.executemany("INSERT INTO players VALUES (?,?,?,?,?,?)", sorted(players.values()))
    db.commit()
    # Compact the file: the page downloads it on every visit
    db.execute("VACUUM")
    db.close()
    print(f"Wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
