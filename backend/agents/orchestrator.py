from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool
from typing import TypedDict, Annotated, List
from langchain_core.messages import BaseMessage
import operator
import os
from dotenv import load_dotenv
from langchain_groq import ChatGroq

load_dotenv()

llm_base = ChatGroq(
    model="llama-3.3-70b-versatile",
    api_key=os.getenv("GROQ_API_KEY")
)

@tool
def get_calendar_events(days_ahead: int = 7) -> list:
    """Fetches real upcoming events from Google Calendar."""
    from services.calendar_service import get_upcoming_deadlines
    return get_upcoming_deadlines(days_ahead)

@tool
def get_github_file_contents(repo_name: str, assignment_description: str) -> dict:
    """Fetches actual file contents from GitHub and analyzes completion against requirements."""
    from github import Github
    from datetime import datetime, timezone
    import re

    g = Github(os.getenv("GITHUB_TOKEN"))
    repo = g.get_repo(repo_name)

    code_content = ""
    try:
        contents = repo.get_contents("")
        files = []
        while contents:
            file = contents.pop(0)
            if file.type == "dir":
                contents.extend(repo.get_contents(file.path))
            else:
                files.append(file.path)
                if file.path.endswith(('.py', '.js', '.ts', '.java', '.cpp', '.c', '.html', '.css', '.ipynb')):
                    try:
                        content = file.decoded_content.decode('utf-8')
                        code_content += f"\n\n--- {file.path} ---\n{content[:3000]}"
                        if len(code_content) > 10000:
                            break
                    except:
                        pass
    except:
        pass

    commits = list(repo.get_commits())
    last_commit = commits[0].commit.author.date if commits else None
    now = datetime.now(timezone.utc)
    hours_since = (now - last_commit).total_seconds() / 3600 if last_commit else 999

    prompt = f"""Assignment requirements:
{assignment_description}

Code in repository:
{code_content[:10000]}

Respond ONLY with JSON, no markdown:
{{
    "percent_complete": <0-100>,
    "completed_parts": ["what is done"],
    "missing_parts": ["what is missing"],
    "estimated_hours_remaining": <float>,
    "assessment": "<2 sentence summary>",
    "last_active_hours_ago": {round(hours_since, 1)},
    "files_found": {len(files) if 'files' in dir() else 0}
}}"""

    response = llm_base.invoke(prompt)
    content = response.content
    if isinstance(content, list):
        text = next((c["text"] for c in content if isinstance(c, dict) and c.get("type") == "text"), "")
    else:
        text = str(content)

    import json
    clean = text.replace('```json', '').replace('```', '').strip()
    try:
        return json.loads(clean)
    except:
        return {"percent_complete": 0, "assessment": text, "estimated_hours_remaining": 3}

@tool
def draft_extension_email(professor_name: str, assignment_name: str, reason: str, days_requested: int, current_progress: str, recipient_type: str = "professor") -> str:
    """Drafts an extension request email or WhatsApp message based on recipient type."""
    if recipient_type in ["hod", "professor"]:
        prompt = f"""Write a formal, concise extension request email.
Professor/HOD: {professor_name}
Assignment: {assignment_name}
Reason: {reason}
Progress so far: {current_progress}
Days requested: {days_requested}
Tone: very respectful, professional, brief. Show effort already made. Make sure to have the proper formatting of an email."""
    else:
        prompt = f"""Write a casual WhatsApp message requesting an extension.
Senior/TA: {professor_name}
Assignment: {assignment_name}
Reason: {reason}
Progress: {current_progress}
Days requested: {days_requested}
Tone: friendly, casual, direct. Like texting a senior."""

    response = llm_base.invoke(prompt)
    return response.content

@tool
def save_decision_to_memory(assignment: str, decision: str, reasoning: str, email_draft: str = "") -> str:
    """Saves the agent decision to PostgreSQL."""
    import asyncio
    from db.models import save_decision
    asyncio.run(save_decision(assignment, decision, reasoning, email_draft))
    return f"Saved decision for: {assignment}"

@tool
def get_past_decisions_for_assignment(assignment_name: str) -> list:
    """Gets past decisions for this assignment from memory."""
    import asyncio
    from db.models import get_past_decisions
    return asyncio.run(get_past_decisions(assignment_name))

@tool
def get_professor_history(professor_name: str) -> list:
    """Gets past extension outcomes for this professor."""
    import asyncio
    from db.models import get_professor_patterns
    return asyncio.run(get_professor_patterns(professor_name))

@tool
def analyze_code_completion(assignment_description: str, code_content: str) -> dict:
    """Analyzes code or essay content against assignment requirements."""
    is_essay = code_content.startswith("ESSAY CONTENT:")

    if is_essay:
        prompt = f"""You are a strict essay reviewer.
Assignment requirements: {assignment_description}
Student essay: {code_content}
RULES: Judge based on content coverage not word count. Empty = 0%. All points covered well = 100%.
Respond ONLY with JSON no markdown:
{{"percent_complete": <0-100>, "completed_parts": [], "missing_parts": [], "estimated_hours_remaining": <float>, "assessment": "<2 sentences>"}}"""
    else:
        prompt = f"""You are a strict code reviewer.
Assignment requirements: {assignment_description}
Student code: {code_content}
RULES: Judge based on functionality. Working = 100%. Right approach small bugs = 70-90%. Empty = 0%.
Respond ONLY with JSON no markdown:
{{"percent_complete": <0-100>, "completed_parts": [], "missing_parts": [], "estimated_hours_remaining": <float>, "assessment": "<2 sentences>"}}"""

    response = llm_base.invoke(prompt)
    content = response.content
    if isinstance(content, list):
        text = next((c["text"] for c in content if isinstance(c, dict) and c.get("type") == "text"), "")
    else:
        text = str(content)

    import json, re
    clean = re.sub(r'```json|```', '', text).strip()
    try:
        return json.loads(clean)
    except:
        return {"percent_complete": 0, "assessment": text, "estimated_hours_remaining": 3, "completed_parts": [], "missing_parts": []}

class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], operator.add]
    assignment_context: dict

tools = [
    get_calendar_events,
    get_github_file_contents,
    draft_extension_email,
    save_decision_to_memory,
    get_past_decisions_for_assignment,
    get_professor_history,
    analyze_code_completion,
]

llm = llm_base.bind_tools(tools)

SYSTEM_PROMPT = """You are an intelligent academic deadline manager.

When planning a student's week:
1. Check Google Calendar for upcoming events and conflicts
2. For GitHub assignments, use get_github_file_contents to read actual code
3. Check past decisions from memory
4. Reason across ALL assignments together
5. Priority order: HOD > Professor > Senior > Self
6. Only recommend extensions when genuinely needed
7. Draft appropriate messages — formal email for HOD/Professor, casual WhatsApp for Senior
8. Save decisions to memory

Be specific, honest, and practical."""

def reasoning_node(state: AgentState) -> AgentState:
    messages = [SystemMessage(content=SYSTEM_PROMPT)] + state["messages"]
    response = llm.invoke(messages)
    return {"messages": [response]}

def should_continue(state: AgentState) -> str:
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return END

tool_node = ToolNode(tools)
workflow = StateGraph(AgentState)
workflow.add_node("reasoning", reasoning_node)
workflow.add_node("tools", tool_node)
workflow.set_entry_point("reasoning")
workflow.add_conditional_edges("reasoning", should_continue)
workflow.add_edge("tools", "reasoning")
agent = workflow.compile()