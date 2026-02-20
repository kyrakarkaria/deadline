from github import Github
from datetime import datetime, timezone
import os
from dotenv import load_dotenv

load_dotenv(dotenv_path="../.env")

def monitor_progress(assignment: dict) -> dict:
    """
    Checks GitHub repo for real commit activity.
    """
    github_token = os.getenv("GITHUB_TOKEN")
    repo_name = assignment.get("github_repo")  # format: "username/repo-name"

    g = Github(github_token)
    repo = g.get_repo(repo_name)
    commits = list(repo.get_commits())

    # Calculate lines written from most recent commits
    total_additions = 0
    for commit in commits[:10]:  # check last 10 commits
        stats = commit.stats
        total_additions += stats.additions

    # When was the last commit?
    last_commit_time = commits[0].commit.author.date
    now = datetime.now(timezone.utc)
    hours_since_last_commit = (now - last_commit_time).total_seconds() / 3600

    return {
        "commits": len(commits),
        "lines_written": total_additions,
        "last_commit_hours_ago": round(hours_since_last_commit, 1),
        "percent_complete": min(len(commits) * 5, 100),
        "source": "github"
    }