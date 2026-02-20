import os
from datetime import datetime, timezone, timedelta
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/gmail.send"
]

def get_calendar_service():
    creds = None
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
            creds = flow.run_local_server(port=0)
        with open("token.json", "w") as f:
            f.write(creds.to_json())
    return build("calendar", "v3", credentials=creds)

def get_upcoming_deadlines(days_ahead: int = 14) -> list:
    service = get_calendar_service()
    now = datetime.now(timezone.utc).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(days=days_ahead)).isoformat()

    events_result = service.events().list(
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
        description = event.get("description", "")

        # Guess recipient type from title
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