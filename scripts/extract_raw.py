import json, os

SRC_DIR = "/root/.claude/projects/-home-claude/4656de4a-9a80-5308-a7ba-5525798f7498/tool-results"
OUT_DIR = "/home/claude/euroleague_platform/data/raw"

FILES = {
    "mcp-remote-devices-euroleague_paid__get_schedule-1789557621266.txt": ("schedule", None),
    "mcp-remote-devices-euroleague_paid__get_schedule-1789563816575.txt": ("schedule", None),
    "mcp-remote-devices-euroleague_paid__get_boxscore_players_season-1789557765200.txt": ("boxscore_players_season", "Season"),
    "mcp-remote-devices-euroleague_paid__get_boxscore_players_season-1789563844389.txt": ("boxscore_players_season", "Season"),
    "mcp-remote-devices-euroleague_paid__get_fouls_analysis_season-1789557798632.txt": ("fouls_analysis_season", None),
    "mcp-remote-devices-euroleague_paid__get_fouls_analysis_season-1789563889563.txt": ("fouls_analysis_season", None),
    "mcp-remote-devices-euroleague_paid__get_games_report_season-1789562964136.txt": ("games_report_season", "Season"),
    "mcp-remote-devices-euroleague_paid__get_games_report_season-1789563848637.txt": ("games_report_season", "Season"),
    "mcp-remote-devices-euroleague_paid__get_games_teams_comparison_season-1789563083845.txt": ("games_teams_comparison_season", "Season"),
    "mcp-remote-devices-euroleague_paid__get_players_msi_season-1789563135722.txt": ("players_msi_season", None),
    "mcp-remote-devices-euroleague_paid__get_players_msi_season-1789563907251.txt": ("players_msi_season", None),
    "mcp-remote-devices-euroleague_paid__get_games_metadata_season-1789557655588.txt": ("games_metadata_season", "Season"),
}

def load_blocks(path):
    with open(path) as f:
        raw = json.load(f)
    out = []
    for block in raw:
        try:
            out.append(json.loads(block["text"]))
        except Exception as e:
            print("skip block error", e)
    return out

results = {}
for fname, (label, season_key) in FILES.items():
    path = os.path.join(SRC_DIR, fname)
    if not os.path.exists(path):
        print("MISSING", fname)
        continue
    data = load_blocks(path)
    season = None
    if season_key and data:
        season = data[0].get(season_key)
    elif label == "schedule" and data:
        # infer season from gamecode e.g. E2024_1
        gc = data[0].get("gamecode","")
        season = gc.split("_")[0].replace("E","") if gc else None
    key = (label, season, fname)
    results[fname] = (label, season, len(data), data)
    print(fname, "->", label, "season=", season, "rows=", len(data))
