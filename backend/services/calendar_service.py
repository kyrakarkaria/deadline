import os
from datetime import datetime, timezone, timedelta
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/tasks.readonly",
    "https://www.googleapis.com/auth/gmail.send"
]

def get_calendar_service():
    import json
    creds = None
    
    # Try environment variable first (for production)
    token_json = os.getenv("GOOGLE_TOKEN_JSON")
    if token_json:
        creds = Credentials.from_authorized_user_info(json.loads(token_json), SCOPES)
    elif os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
            creds = flow.run_local_server(port=0)
        with open("token.json", "w") as f:
            f.write(creds.to_json())
    
    return creds

def get_upcoming_deadlines(days_ahead: int = 14) -> list:
    creds = get_calendar_service()
    cal_service = build("calendar", "v3", credentials=creds)
    tasks_service = build("tasks", "v1", credentials=creds)

    now = datetime.now(timezone.utc).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(days=days_ahead)).isoformat()

    # Build a map of task title -> description from Google Tasks
    task_descriptions = {}
    try:
        tasklists = tasks_service.tasklists().list().execute()
        for tasklist in tasklists.get("items", []):
            tasks = tasks_service.tasks().list(
                tasklist=tasklist["id"],
                showCompleted=False
            ).execute()
            for task in tasks.get("items", []):
                title = task.get("title", "")
                notes = task.get("notes", "")
                if title and notes:
                    task_descriptions[title.lower()] = notes
    except Exception as e:
        print(f"Tasks fetch error: {e}")

    # Get calendar events
    events_result = cal_service.events().list(
        calendarId="primary",
        timeMin=now,
        timeMax=future,
        singleEvents=True,
        orderBy="startTime"
    ).execute()

    events = events_result.get("items", [])
    deadlines = []

    for event in events:
        start = event["start"].get("dateTime", event["start"].get("date"))
        title = event.get("summary", "Untitled")

        # Try to get description from Tasks API using title match
        raw_desc = event.get("description", "")
        if "tasks.google.com" in raw_desc or "Changes made to the title" in raw_desc:
            raw_desc = task_descriptions.get(title.lower(), "")
        description = raw_desc

        title_lower = title.lower()
        if "hod" in title_lower:
            recipient = "hod"
        elif any(w in title_lower for w in ["prof", "professor", "exam", "quiz", "viva"]):
            recipient = "professor"
        elif any(w in title_lower for w in ["senior", "ta", "mentor"]):
            recipient = "senior"
        else:
            recipient = "professor"

        deadlines.append({
            "title": title,
            "due": start,
            "description": description,
            "recipient_type": recipient,
            "type": "assignment"
        })

    return deadlines