import json, os

SRC_DIR = "/root/.claude/projects/-home-claude/4656de4a-9a80-5308-a7ba-5525798f7498/tool-results"
OUT_DIR = "/home/claude/euroleague_platform/data/raw"

# (filename, label, season)
FILES = [
    ("mcp-remote-devices-euroleague_paid__get_schedule-1789557621266.txt", "schedule", 2024),
    ("mcp-remote-devices-euroleague_paid__get_schedule-1789563816575.txt", "schedule", 2025),
    ("mcp-remote-devices-euroleague_paid__get_boxscore_players_season-1789557765200.txt", "boxscore_players_season", 2024),
    ("mcp-remote-devices-euroleague_paid__get_boxscore_players_season-1789563844389.txt", "boxscore_players_season", 2025),
    ("mcp-remote-devices-euroleague_paid__get_fouls_analysis_season-1789557798632.txt", "fouls_analysis_season", 2024),
    ("mcp-remote-devices-euroleague_paid__get_fouls_analysis_season-1789563889563.txt", "fouls_analysis_season", 2025),
    ("mcp-remote-devices-euroleague_paid__get_games_report_season-1789562964136.txt", "games_report_season", 2024),
    ("mcp-remote-devices-euroleague_paid__get_games_report_season-1789563848637.txt", "games_report_season", 2025),
    ("mcp-remote-devices-euroleague_paid__get_games_teams_comparison_season-1789563083845.txt", "games_teams_comparison_season", 2024),
    ("mcp-remote-devices-euroleague_paid__get_players_msi_season-1789563135722.txt", "players_msi_season", 2024),
    ("mcp-remote-devices-euroleague_paid__get_players_msi_season-1789563907251.txt", "players_msi_season", 2025),
]

def load_blocks(path):
    with open(path) as f:
        raw = json.load(f)
    out = []
    for block in raw:
        out.append(json.loads(block["text"]))
    return out

for fname, label, season in FILES:
    path = os.path.join(SRC_DIR, fname)
    data = load_blocks(path)
    out_dir = os.path.join(OUT_DIR, str(season))
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{label}.json")
    with open(out_path, "w") as f:
        json.dump(data, f)
    print(f"wrote {out_path} ({len(data)} rows, {os.path.getsize(out_path)/1024:.0f} KB)")
