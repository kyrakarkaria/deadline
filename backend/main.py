from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse
from langchain_core.messages import HumanMessage
from agents.orchestrator import agent, analyze_code_completion
from pydantic import BaseModel
from db.models import get_connection, get_all_assignments, update_assignment_status
from services.gmail_service import send_email as gmail_send
import json

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── MODELS ────────────────────────────────────────────────────────────────

class AssignmentInput(BaseModel):
    name: str
    description: str
    due: str
    difficulty: int = 3
    weight: int = 100
    type: str = "code"
    linked_resource: str = ""
    resource_type: str = "github"
    recipient_type: str = "professor"
    professor_email: str = ""

class EmailPayload(BaseModel):
    to: str
    subject: str
    body: str

class ProgressInput(BaseModel):
    assignment_id: int
    type: str
    value: float

class CodeInput(BaseModel):
    code: str

class CodeSaveInput(BaseModel):
    code: str

class DocSaveInput(BaseModel):
    content: str

class AnalyzeCodeInput(BaseModel):
    assignment_id: int
    code_content: str

class AnalyzeDocInput(BaseModel):
    assignment_id: int
    doc_content: str

# ─── ASSIGNMENTS ────────────────────────────────────────────────────────────

@app.post("/api/assignments")
async def create_assignment(data: AssignmentInput):
    from datetime import datetime
    conn = await get_connection()
    due_dt = datetime.fromisoformat(data.due)
    row = await conn.fetchrow("""
        INSERT INTO assignments (name, description, due, difficulty, weight, type,
                                linked_resource, resource_type, recipient_type, professor_email)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
    """, data.name, data.description, due_dt, data.difficulty, data.weight,
        data.type, data.linked_resource, data.resource_type,
        data.recipient_type, data.professor_email)
    await conn.close()
    return {"id": row["id"], "message": "Assignment saved"}

@app.get("/api/assignments")
async def list_assignments():
    assignments = await get_all_assignments()
    for a in assignments:
        if a.get("due"): a["due"] = a["due"].isoformat()
        if a.get("created_at"): a["created_at"] = a["created_at"].isoformat()
    return assignments

@app.get("/api/assignments/{assignment_id}")
async def get_assignment(assignment_id: int):
    conn = await get_connection()
    row = await conn.fetchrow("SELECT * FROM assignments WHERE id = $1", assignment_id)
    await conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    result = dict(row)
    if result.get("due"): result["due"] = result["due"].isoformat()
    if result.get("created_at"): result["created_at"] = result["created_at"].isoformat()
    return result

@app.patch("/api/assignments/{assignment_id}")
async def update_status(assignment_id: int, status: str):
    await update_assignment_status(assignment_id, status)
    return {"message": "Updated"}

@app.post("/api/assignments/{assignment_id}/code")
async def save_code(assignment_id: int, data: CodeSaveInput):
    conn = await get_connection()
    await conn.execute(
        "UPDATE assignments SET code_content = $1 WHERE id = $2",
        data.code, assignment_id
    )
    await conn.close()
    return {"status": "saved"}
@app.post("/api/sync-github/{assignment_id}")
async def sync_github(assignment_id: int):
    conn = await get_connection()
    row = await conn.fetchrow("SELECT * FROM assignments WHERE id = $1", assignment_id)
    await conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    
    assignment = dict(row)
    if not assignment.get("linked_resource"):
        return {"error": "No GitHub repo linked"}

    from agents.orchestrator import get_github_file_contents
    result = get_github_file_contents.invoke({
        "repo_name": assignment["linked_resource"],
        "assignment_description": assignment["description"] or "No description"
    })

    if isinstance(result, dict) and "percent_complete" in result:
        conn = await get_connection()
        await conn.execute(
            "UPDATE assignments SET progress_percent = $1 WHERE id = $2",
            result["percent_complete"], assignment_id
        )
        await conn.close()

    return result

@app.post("/api/assignments/{assignment_id}/doc")
async def save_doc(assignment_id: int, data: DocSaveInput):
    conn = await get_connection()
    await conn.execute(
        "UPDATE assignments SET doc_content = $1 WHERE id = $2",
        data.content, assignment_id
    )
    await conn.close()
    return {"status": "saved"}

# ─── CALENDAR SYNC ──────────────────────────────────────────────────────────

@app.get("/api/calendar-sync")
async def calendar_sync():
    from services.calendar_service import get_upcoming_deadlines
    from datetime import datetime
    
    events = get_upcoming_deadlines(14)
    added = 0
    
    for event in events:
        try:
            conn = await get_connection()
            existing = await conn.fetchrow(
                "SELECT id FROM assignments WHERE name = $1", event["title"]
            )
            if not existing:
                due_str = event["due"]
                try:
                    due_dt = datetime.fromisoformat(due_str)
                except:
                    due_dt = datetime.fromisoformat(due_str.replace("Z", "+00:00"))
                
                await conn.execute("""
                    INSERT INTO assignments 
                    (name, description, due, type, recipient_type, weight, difficulty)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                """, event["title"],
                    event.get("description", "Synced from Google Calendar"),
                    due_dt, "other", event.get("recipient_type", "professor"), 100, 3)
                added += 1
            await conn.close()
        except Exception as e:
            print(f"Sync error: {e}")
    
    return {"synced": added}
# ─── CODE RUNNER ────────────────────────────────────────────────────────────

@app.post("/api/run-code")
async def run_code(data: CodeInput):
    import subprocess, sys, tempfile, os
    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(data.code)
            tmp_path = f.name
        result = subprocess.run(
            [sys.executable, tmp_path],
            capture_output=True, text=True, timeout=60,
            cwd="/Users/kyrakarkaria/Desktop/deadline/backend"
        )
        os.unlink(tmp_path)
        output = result.stdout if result.stdout else result.stderr
        return {"output": output}
    except subprocess.TimeoutExpired:
        return {"error": "Timed out after 60 seconds"}
    except Exception as e:
        return {"error": str(e)}

# ─── PROGRESS ───────────────────────────────────────────────────────────────

@app.post("/api/progress")
async def save_progress(data: ProgressInput):
    conn = await get_connection()
    await conn.execute(
        "UPDATE assignments SET progress_percent = $1 WHERE id = $2",
        min(int(data.value), 100), data.assignment_id
    )
    await conn.close()
    return {"status": "saved"}

@app.post("/api/analyze-code")
async def analyze_code(data: AnalyzeCodeInput):
    assignments = await get_all_assignments()
    assignment = next((a for a in assignments if a["id"] == data.assignment_id), None)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    result = analyze_code_completion.invoke({
        "assignment_description": assignment["description"],
        "code_content": data.code_content
    })
    if isinstance(result, dict) and "percent_complete" in result:
        conn = await get_connection()
        await conn.execute(
            "UPDATE assignments SET progress_percent = $1 WHERE id = $2",
            result["percent_complete"], data.assignment_id
        )
        await conn.close()
    return result

@app.post("/api/analyze-doc")
async def analyze_doc(data: AnalyzeDocInput):
    assignments = await get_all_assignments()
    assignment = next((a for a in assignments if a["id"] == data.assignment_id), None)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    result = analyze_code_completion.invoke({
        "assignment_description": assignment["description"],
        "code_content": f"ESSAY CONTENT:\n{data.doc_content}"
    })
    if isinstance(result, dict) and "percent_complete" in result:
        conn = await get_connection()
        await conn.execute(
            "UPDATE assignments SET progress_percent = $1 WHERE id = $2",
            result["percent_complete"], data.assignment_id
        )
        await conn.close()
    return result

# ─── EMAIL ──────────────────────────────────────────────────────────────────

@app.post("/api/send-email")
async def send_email_endpoint(payload: EmailPayload):
    result = gmail_send(payload.to, payload.subject, payload.body)
    return result

# ─── AI PLANNER ─────────────────────────────────────────────────────────────

@app.get("/api/plan-stream")
async def plan_stream():
    async def event_generator():
        try:
            yield {"data": json.dumps({"type": "status", "content": "Analyzing your full workload..."})}

            assignments = await get_all_assignments()
            for a in assignments:
                if a.get("due"): a["due"] = a["due"].isoformat()
                if a.get("created_at"): a["created_at"] = a["created_at"].isoformat()

            prompt = f"""You are an academic planning agent. Analyze this student's full workload.

Assignments:
{json.dumps(assignments, indent=2, default=str)}

Priority rules:
- HOD assignments: highest priority, most formal extension requests
- Professor assignments: high priority, formal email if extension needed  
- Senior/TA assignments: medium priority, casual WhatsApp message if extension needed
- Self/personal: lowest priority

For each assignment consider progress_percent (real AI-analyzed completion), due date, weight, and description.

Your output MUST have these exact sections:

## Priority Order
List tasks 1,2,3 with recipient type and urgency reason

## Time Estimates
For each task: hours needed to complete, hours until deadline, risk level

## 48-Hour Schedule
Specific hour blocks — what to work on and when

## Extension Recommendations
Only if genuinely needed. Who to contact, why, how many days

## Draft Messages
For each extension needed:
- Professor/HOD: formal email with Subject line
- Senior: casual WhatsApp message to copy-paste

Be specific, honest, and practical. Don't sugarcoat risks."""

            async for event in agent.astream_events(
                {"messages": [HumanMessage(content=prompt)], "assignment_context": {}},
                version="v2"
            ):
                kind = event["event"]
                if kind == "on_chat_model_stream":
                    chunk = event["data"]["chunk"]
                    content = chunk.content
                    if isinstance(content, list):
                        for c in content:
                            if isinstance(c, dict) and c.get("type") == "text" and c.get("text"):
                                yield {"data": json.dumps({"type": "stream", "content": c["text"]})}
                    elif isinstance(content, str) and content:
                        yield {"data": json.dumps({"type": "stream", "content": content})}
                elif kind == "on_tool_start":
                    yield {"data": json.dumps({"type": "tool_start", "content": f"Checking {event['name']}..."})}
                elif kind == "on_tool_end":
                    yield {"data": json.dumps({"type": "tool_end", "content": f"{event['name']} done"})}

            yield {"data": json.dumps({"type": "done"})}

        except Exception as e:
            yield {"data": json.dumps({"type": "error", "content": str(e)})}

    return EventSourceResponse(event_generator(), ping=15)

# ─── HEALTH ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}