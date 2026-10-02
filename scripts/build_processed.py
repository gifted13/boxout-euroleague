"""
EuroLeague Basketball Intelligence Platform - ETL / Analytics Engine
Builds the processed (derived metrics) data layer from raw euroleague_paid data.

Layers:
  Raw Data Layer        -> data/raw/{season}/*.json   (verbatim from API)
  Normalization Layer    -> pandas DataFrames in this script
  Derived Metrics Layer  -> computed team/player season stats, rankings, form
  Analytics Engine       -> data/processed/{season}/*.json (consumed by the app)
"""
import json, os, math, ast
from collections import defaultdict
import pandas as pd
import numpy as np


def parse_form(v):
    """The API serializes last-5-form as a Python-repr string, e.g. "['W','L']" -> ['W','L']."""
    if isinstance(v, list):
        return v
    if not v or not isinstance(v, str):
        return None
    try:
        parsed = ast.literal_eval(v)
        return list(parsed) if isinstance(parsed, (list, tuple)) else None
    except Exception:
        return None

RAW = "/home/claude/euroleague_platform/data/raw"
OUT = "/home/claude/euroleague_platform/data/processed"

SEASONS = [2024, 2025]

STAT_COLS = ["Points","FieldGoalsMade2","FieldGoalsAttempted2","FieldGoalsMade3",
             "FieldGoalsAttempted3","FreeThrowsMade","FreeThrowsAttempted",
             "OffensiveRebounds","DefensiveRebounds","TotalRebounds","Assistances",
             "Steals","Turnovers","BlocksFavour","BlocksAgainst","FoulsCommited",
             "FoulsReceived","Valuation"]


def load(season, name):
    path = os.path.join(RAW, str(season), f"{name}.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def mmss_to_minutes(s):
    if not s or not isinstance(s, str) or ":" not in s:
        return 0.0
    try:
        m, sec = s.split(":")
        return int(m) + int(sec) / 60.0
    except Exception:
        return 0.0


def safe_div(a, b):
    return a / b if b else 0.0


def build_team_trad(box_slice):
    """Team season traditional averages from a slice of the (already-cleaned) player boxscore."""
    if box_slice.empty:
        return pd.DataFrame()
    team_game = box_slice.groupby(["Team", "Gamecode"])[STAT_COLS].sum().reset_index()
    team_trad = team_game.groupby("Team").agg(
        GP=("Gamecode", "nunique"),
        PPG=("Points", "mean"),
        FGM2=("FieldGoalsMade2", "mean"), FGA2=("FieldGoalsAttempted2", "mean"),
        FGM3=("FieldGoalsMade3", "mean"), FGA3=("FieldGoalsAttempted3", "mean"),
        FTM=("FreeThrowsMade", "mean"), FTA=("FreeThrowsAttempted", "mean"),
        ORB=("OffensiveRebounds", "mean"), DRB=("DefensiveRebounds", "mean"),
        TRB=("TotalRebounds", "mean"), AST=("Assistances", "mean"),
        STL=("Steals", "mean"), TOV=("Turnovers", "mean"),
        BLK=("BlocksFavour", "mean"), BLKA=("BlocksAgainst", "mean"),
        PF=("FoulsCommited", "mean"), PFR=("FoulsReceived", "mean"),
        VAL=("Valuation", "mean"),
    ).reset_index()
    team_trad["FG2_PCT"] = team_trad["FGM2"] / team_trad["FGA2"]
    team_trad["FG3_PCT"] = team_trad["FGM3"] / team_trad["FGA3"]
    team_trad["FT_PCT"] = team_trad["FTM"] / team_trad["FTA"]
    team_trad["FGM_TOTAL"] = team_trad["FGM2"] + team_trad["FGM3"]
    team_trad["FGA_TOTAL"] = team_trad["FGA2"] + team_trad["FGA3"]
    team_trad["FG_PCT"] = team_trad["FGM_TOTAL"] / team_trad["FGA_TOTAL"]
    return team_trad


def build_player_agg(played_slice, qualifier_games=None):
    """Player season per-game averages + shooting splits + derived metrics from a slice of played rows."""
    if played_slice.empty:
        return pd.DataFrame()

    def last_val(s):
        return s.iloc[-1]

    player_agg = played_slice.groupby("Player_ID").agg(
        Player=("Player", "last"),
        Team=("Team", last_val),
        GP=("Gamecode", "nunique"),
        GS=("IsStarter", "sum"),
        MIN=("MinutesFloat", "mean"),
        PTS=("Points", "mean"),
        FGM2=("FieldGoalsMade2", "mean"), FGA2=("FieldGoalsAttempted2", "mean"),
        FGM3=("FieldGoalsMade3", "mean"), FGA3=("FieldGoalsAttempted3", "mean"),
        FTM=("FreeThrowsMade", "mean"), FTA=("FreeThrowsAttempted", "mean"),
        ORB=("OffensiveRebounds", "mean"), DRB=("DefensiveRebounds", "mean"),
        TRB=("TotalRebounds", "mean"), AST=("Assistances", "mean"),
        STL=("Steals", "mean"), TOV=("Turnovers", "mean"),
        BLK=("BlocksFavour", "mean"), BLKA=("BlocksAgainst", "mean"),
        PF=("FoulsCommited", "mean"), PFR=("FoulsReceived", "mean"),
        VAL=("Valuation", "mean"), PM=("Plusminus", "mean"),
        Dorsal=("Dorsal", "last"),
    ).reset_index()

    player_agg["FG2_PCT"] = player_agg["FGM2"] / player_agg["FGA2"]
    player_agg["FG3_PCT"] = player_agg["FGM3"] / player_agg["FGA3"]
    player_agg["FT_PCT"] = player_agg["FTM"] / player_agg["FTA"]
    player_agg["FGM_TOTAL"] = player_agg["FGM2"] + player_agg["FGM3"]
    player_agg["FGA_TOTAL"] = player_agg["FGA2"] + player_agg["FGA3"]
    player_agg["FG_PCT"] = player_agg["FGM_TOTAL"] / player_agg["FGA_TOTAL"]
    # True Shooting % = PTS / (2 * (FGA + 0.44*FTA))
    denom = 2 * (player_agg["FGA_TOTAL"] + 0.44 * player_agg["FTA"])
    player_agg["TS_PCT"] = np.where(denom > 0, player_agg["PTS"] / denom, np.nan)
    # eFG% = (FGM2 + 1.5*FGM3) / FGA_total
    player_agg["EFG_PCT"] = np.where(player_agg["FGA_TOTAL"] > 0,
                                      (player_agg["FGM2"] + 1.5 * player_agg["FGM3"]) / player_agg["FGA_TOTAL"], np.nan)
    # Per-36
    for col in ["PTS", "TRB", "AST", "STL", "BLK", "TOV"]:
        player_agg[f"{col}_PER36"] = np.where(player_agg["MIN"] > 0, player_agg[col] / player_agg["MIN"] * 36, np.nan)

    if qualifier_games is not None:
        player_agg["qualified"] = player_agg["GP"] >= qualifier_games

    return player_agg


for season in SEASONS:
    print(f"\n=== Season {season} ===")
    out_dir = os.path.join(OUT, str(season))
    os.makedirs(out_dir, exist_ok=True)

    standings = load(season, "standings") or []
    teams_adv = load(season, "teams_advanced_stats") or []
    teams_eff = load(season, "teams_efficiency_landscape") or []
    teams_bb = load(season, "teams_buzzer_beaters") or []
    shot_zones = load(season, "shot_zones") or {}
    schedule = load(season, "schedule") or []
    games_report = load(season, "games_report_season") or []
    boxscore = load(season, "boxscore_players_season") or []
    fouls = load(season, "fouls_analysis_season") or []
    msi = load(season, "players_msi_season") or []
    games_cmp = load(season, "games_teams_comparison_season") or []

    box_df = pd.DataFrame(boxscore)
    # The raw boxscore includes synthetic per-team summary rows (Player_ID == "Total"/"Team")
    # alongside real player rows. These must be excluded before any aggregation, or team/player
    # totals get double-counted (e.g. team PPG comes out ~2x the real value).
    n_before = len(box_df)
    box_df = box_df[~box_df["Player_ID"].isin(["Total", "Team"])].copy()
    print(f"  filtered {n_before - len(box_df)} synthetic Total/Team rows from boxscore ({len(box_df)} player rows remain)")
    box_df["MinutesFloat"] = box_df["Minutes"].apply(mmss_to_minutes)
    box_df["Played"] = box_df["MinutesFloat"] > 0

    # Gamecode is globally unique across phases within a season (RS/PI/PO/FF never reuse numbers),
    # so this map lets any other Gamecode-keyed dataset (e.g. fouls_analysis, which carries no
    # Phase column of its own) be filtered/labeled by phase too.
    gamecode_phase = box_df.drop_duplicates("Gamecode").set_index("Gamecode")["Phase"].to_dict()

    # Regular-season-only slice: standings (wins/losses/games_played) are RS-only, so the primary
    # "team season" / "player season" tables are built from RS games to stay consistent with them.
    # Playoffs/Play-In/Final Four games are preserved separately (team_playoffs / player_playoffs)
    # rather than silently blended in.
    box_rs = box_df[box_df["Phase"] == "RS"].copy()
    box_post = box_df[box_df["Phase"] != "RS"].copy()

    # ---------- TEAM SEASON TRADITIONAL AVERAGES (Regular Season) ----------
    team_trad = build_team_trad(box_rs)

    # merge everything into one team_season table
    adv_df = pd.DataFrame(teams_adv)
    eff_df = pd.DataFrame(teams_eff)
    bb_df = pd.DataFrame(teams_bb)
    standings_df = pd.DataFrame(standings)

    team_season = standings_df.merge(team_trad, left_on="team_code", right_on="Team", how="left")
    team_season = team_season.drop(columns=["Team"])  # redundant with team_code; drop now to avoid a later merge-suffix collision
    team_season = team_season.merge(adv_df, left_on="team_code", right_on="club", how="left", suffixes=("", "_adv"))
    team_season = team_season.merge(
        eff_df[["index", "off_rtg_home", "def_rtg_home", "net_rtg_home", "off_rtg_away", "def_rtg_away", "net_rtg_away"]],
        left_on="team_code", right_on="index", how="left")
    if not bb_df.empty:
        team_season = team_season.merge(
            bb_df.rename(columns={"BuzzerBeaters": "buzzer_beaters", "BuzzerChokers": "buzzer_chokers", "Team": "bb_team_name"}),
            left_on="team_name", right_on="bb_team_name", how="left")

    # win pct, last-5 form from games_report (based on most recent played game per team)
    gr_df = pd.DataFrame(games_report)
    form_map = {}
    if not gr_df.empty:
        gr_df = gr_df.sort_values("date")
        for _, row in gr_df.iterrows():
            if not row.get("played"):
                continue
            form_map[row["local.club.code"]] = row.get("localLast5Form")
            form_map[row["road.club.code"]] = row.get("roadLast5Form")
    team_season["last5_form"] = team_season["team_code"].map(form_map).apply(parse_form)
    team_season["win_pct"] = team_season["wins"] / team_season["games_played"]

    team_season_clean = team_season.drop(columns=[c for c in ["Team", "club", "index", "bb_team_name"] if c in team_season.columns])
    team_season_records = json.loads(team_season_clean.to_json(orient="records"))
    with open(os.path.join(out_dir, "team_season.json"), "w") as f:
        json.dump(team_season_records, f)
    print("team_season (RS):", len(team_season_records), "teams")

    # ---------- TEAM PLAYOFFS/PLAY-IN/FINAL FOUR AVERAGES (postseason, teams that qualified only) ----------
    team_post_trad = build_team_trad(box_post)
    if not team_post_trad.empty:
        team_post = team_post_trad.merge(
            standings_df[["team_code", "team_name"]], left_on="Team", right_on="team_code", how="left")
        team_post = team_post.drop(columns=["Team"])
        # per-phase game counts, so the UI can show e.g. "2 Play-In + 5 Playoffs + 2 Final Four"
        phase_counts = box_post.drop_duplicates(["Team", "Gamecode"]).groupby(["Team", "Phase"]).size().unstack(fill_value=0)
        phase_counts_map = phase_counts.to_dict("index")
        team_post["phase_games"] = team_post["team_code"].map(lambda t: phase_counts_map.get(t, {}))
        team_post_records = json.loads(team_post.to_json(orient="records"))
        with open(os.path.join(out_dir, "team_playoffs.json"), "w") as f:
            json.dump(team_post_records, f)
        print("team_playoffs (PI+PO+FF):", len(team_post_records), "teams")
    else:
        with open(os.path.join(out_dir, "team_playoffs.json"), "w") as f:
            json.dump([], f)
        print("team_playoffs: none (no postseason games in this dataset)")

    # ---------- TEAM GAME LOG (for trend/rolling analysis + Games tab); ALL phases, phase-labeled ----------
    team_games = []
    if not gr_df.empty:
        for _, row in gr_df.iterrows():
            if not row.get("played"):
                continue
            base = dict(
                gamecode=row["Gamecode"], round=row["Round"], round_name=row.get("roundName"),
                phase=row.get("Phase"), date=row.get("date"),
            )
            team_games.append(dict(base, team=row["local.club.code"], team_name=row["local.club.name"],
                                    opponent=row["road.club.code"], opponent_name=row["road.club.name"],
                                    home=True, team_score=row["local.score"], opp_score=row["road.score"],
                                    win=row["local.score"] > row["road.score"], form=parse_form(row.get("localLast5Form"))))
            team_games.append(dict(base, team=row["road.club.code"], team_name=row["road.club.name"],
                                    opponent=row["local.club.code"], opponent_name=row["local.club.name"],
                                    home=False, team_score=row["road.score"], opp_score=row["local.score"],
                                    win=row["road.score"] > row["local.score"], form=parse_form(row.get("roadLast5Form"))))
    with open(os.path.join(out_dir, "team_games.json"), "w") as f:
        json.dump(team_games, f)
    print("team_games (all phases):", len(team_games), "rows")

    # ---------- PLAYER SEASON AGGREGATES (Regular Season) ----------
    played_rs = box_rs[box_rs["Played"]]
    max_round = box_rs["Round"].max() if "Round" in box_rs and not box_rs.empty else 34
    qualifier_games = max(8, int(max_round * 0.4))
    player_agg = build_player_agg(played_rs, qualifier_games=qualifier_games)

    player_records = json.loads(player_agg.to_json(orient="records"))
    with open(os.path.join(out_dir, "player_season.json"), "w") as f:
        json.dump({"qualifier_games": qualifier_games, "players": player_records}, f)
    print("player_season (RS):", len(player_records), "players; qualifier:", qualifier_games, "GP")

    # ---------- PLAYER PLAYOFFS/PLAY-IN/FINAL FOUR AGGREGATES (postseason, no qualifier) ----------
    played_post = box_post[box_post["Played"]]
    player_post_agg = build_player_agg(played_post)
    player_post_records = json.loads(player_post_agg.to_json(orient="records")) if not player_post_agg.empty else []
    with open(os.path.join(out_dir, "player_playoffs.json"), "w") as f:
        json.dump(player_post_records, f)
    print("player_playoffs (PI+PO+FF):", len(player_post_records), "players")

    # ---------- PLAYER GAME LOG (trimmed columns, sorted); ALL phases, phase-labeled ----------
    played_df = box_df[box_df["Played"]]
    log_cols = ["Player_ID", "Player", "Team", "Phase", "Round", "Gamecode", "Home", "IsStarter", "MinutesFloat",
                "Points", "FieldGoalsMade2", "FieldGoalsAttempted2", "FieldGoalsMade3", "FieldGoalsAttempted3",
                "FreeThrowsMade", "FreeThrowsAttempted", "OffensiveRebounds", "DefensiveRebounds", "TotalRebounds",
                "Assistances", "Steals", "Turnovers", "BlocksFavour", "BlocksAgainst", "FoulsCommited", "Valuation", "Plusminus"]
    log_df = played_df[log_cols].sort_values(["Player_ID", "Gamecode"])
    log_df = log_df.rename(columns={"MinutesFloat": "Minutes"})
    with open(os.path.join(out_dir, "player_game_log.json"), "w") as f:
        f.write(log_df.to_json(orient="records"))
    print("player_game_log (all phases):", len(log_df), "rows")

    # ---------- ROSTERS (all phases, so playoff-only call-ups are included) ----------
    rosters = played_df.groupby("Team").apply(
        lambda g: sorted(g.groupby("Player_ID").agg(Player=("Player", "last"), Dorsal=("Dorsal", "last")).reset_index().to_dict("records"),
                          key=lambda r: r["Player"]),
        include_groups=False,
    ).to_dict()
    with open(os.path.join(out_dir, "rosters.json"), "w") as f:
        json.dump(rosters, f)
    print("rosters:", len(rosters), "teams")

    # ---------- FOULS SUMMARY PER TEAM (Regular Season, to match team_season) ----------
    fouls_df = pd.DataFrame(fouls)
    if not fouls_df.empty:
        fouls_df["Phase"] = fouls_df["GAMECODE"].map(gamecode_phase)
        fouls_rs = fouls_df[fouls_df["Phase"] == "RS"]
        fouls_team = fouls_rs.groupby("TEAM").agg(
            games=("GAMECODE", "nunique"),
            fouls_to_FT_rate=("Fouls_Lead_To_Free_Throws", "mean"),
        ).reset_index()
        # need per-game total (sum over 4 quarters) first for an accurate per-game average
        fpg = fouls_rs.groupby(["TEAM", "GAMECODE"])["Total_Fouls"].sum().reset_index()
        fpg_avg = fpg.groupby("TEAM")["Total_Fouls"].mean().reset_index().rename(columns={"Total_Fouls": "fouls_per_game"})
        fouls_team = fouls_team.merge(fpg_avg, on="TEAM")
        with open(os.path.join(out_dir, "fouls_team_summary.json"), "w") as f:
            json.dump(json.loads(fouls_team.to_json(orient="records")), f)
        print("fouls_team_summary (RS):", len(fouls_team))

    # ---------- MSI passthrough (already clean) ----------
    with open(os.path.join(out_dir, "players_msi_season.json"), "w") as f:
        json.dump(msi, f)

    # ---------- SHOT ZONES passthrough ----------
    with open(os.path.join(out_dir, "shot_zones.json"), "w") as f:
        json.dump(shot_zones, f)

    # ---------- LEAGUE AVERAGES (Regular Season) ----------
    league_avg = {
        "PPG": float(team_trad["PPG"].mean()), "FG_PCT": float(team_trad["FG_PCT"].mean()),
        "FG3_PCT": float(team_trad["FG3_PCT"].mean()), "FT_PCT": float(team_trad["FT_PCT"].mean()),
        "TRB": float(team_trad["TRB"].mean()), "AST": float(team_trad["AST"].mean()),
        "STL": float(team_trad["STL"].mean()), "TOV": float(team_trad["TOV"].mean()),
        "PACE": float(adv_df["PACE"].mean()) if not adv_df.empty else None,
        "ORtg": float(adv_df["ORtg"].mean()) if not adv_df.empty else None,
        "player_PTS": float(player_agg[player_agg.qualified]["PTS"].mean()),
        "player_TRB": float(player_agg[player_agg.qualified]["TRB"].mean()),
        "player_AST": float(player_agg[player_agg.qualified]["AST"].mean()),
        "player_TS_PCT": float(player_agg[player_agg.qualified]["TS_PCT"].mean()),
    }
    with open(os.path.join(out_dir, "league_averages.json"), "w") as f:
        json.dump(league_avg, f)
    print("league_averages (RS) computed")

    # ---------- SCHEDULE passthrough (trimmed) ----------
    sched_df = pd.DataFrame(schedule)
    with open(os.path.join(out_dir, "schedule.json"), "w") as f:
        f.write(sched_df.to_json(orient="records"))

print("\nDONE.")
