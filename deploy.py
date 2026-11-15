"""Publish this folder to the default branch using the GitHub Contents API."""
import base64
import getpass
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SKIP = {".git", "__pycache__", ".DS_Store", "random-qr.png"}

def git_remote():
    try:
        value = subprocess.check_output(["git", "remote", "get-url", "origin"], cwd=ROOT, text=True).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        raise SystemExit("Run this from a clone with an origin GitHub remote.")
    value = value.removesuffix(".git")
    if value.startswith("git@github.com:"):
        value = value.removeprefix("git@github.com:")
    elif value.startswith("https://github.com/"):
        value = value.removeprefix("https://github.com/")
    else:
        raise SystemExit("The origin remote must point to github.com.")
    parts = value.split("/")
    if len(parts) != 2: raise SystemExit("Could not determine owner and repository from origin.")
    return parts

def request(url, token, method="GET", payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Accept":"application/vnd.github+json", "Authorization":f"Bearer {token}", "X-GitHub-Api-Version":"2022-11-28", "Content-Type":"application/json", "User-Agent":"FJ-static-site-deployer"})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response) if response.status != 204 else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")
        if error.code in (401, 403): raise SystemExit(f"GitHub rejected access ({error.code}). Check that the token has Contents write access and Pages administration access. Details: {body}")
        if error.code == 404: raise SystemExit("GitHub returned 404. Verify repository access and permissions.")
        raise SystemExit(f"GitHub API error {error.code}: {body}")
    except urllib.error.URLError as error:
        raise SystemExit(f"Could not reach GitHub: {error.reason}")

def main():
    owner, repo = git_remote()
    token = getpass.getpass("GitHub token (not saved): ").strip()
    if not token: raise SystemExit("No token entered; nothing was changed.")
    api = f"https://api.github.com/repos/{owner}/{repo}"
    info = request(api, token)
    branch = info.get("default_branch")
    if not branch: raise SystemExit("Could not determine the repository's default branch.")
    print(f"Publishing to {owner}/{repo}, default branch {branch}.")
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file() or any(part in SKIP for part in path.relative_to(ROOT).parts): continue
        relative = path.relative_to(ROOT).as_posix()
        content = base64.b64encode(path.read_bytes()).decode("ascii")
        endpoint = f"{api}/contents/{relative}"
        try: existing = request(endpoint + f"?ref={branch}", token)
        except SystemExit as error:
            if "404" not in str(error): raise
            existing = None
        payload = {"message":f"Update {relative}", "content":content, "branch":branch}
        if existing and existing.get("sha"): payload["sha"] = existing["sha"]
        request(endpoint, token, "PUT", payload)
        print(f"Updated {relative}")
    try:
        request(api + "/pages", token)
        print("GitHub Pages is enabled.")
    except SystemExit as error:
        if "404" not in str(error): raise
        try:
            request(api + "/pages", token, "POST", {"source":{"branch":branch,"path":"/"}})
            print("Enabled GitHub Pages from the repository root.")
        except SystemExit as create_error:
            raise SystemExit(f"Files were published, but Pages could not be enabled automatically. Check Pages settings and token permissions. {create_error}")
    print(f"Published. GitHub Pages may take a few minutes: https://{owner}.github.io/{repo}/")

if __name__ == "__main__": main()
