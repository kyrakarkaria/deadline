import { useState, useRef, useEffect } from "react";
import Editor from "@monaco-editor/react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  LayoutDashboard, PlusCircle, CalendarClock, Code2, FileText,
  Github, RefreshCw, CheckCircle, Send, Copy, ChevronRight,
  Clock, AlertTriangle, Sparkles, BookOpen, Cpu, Mail, X, RotateCcw
} from "lucide-react";

const API = "http://127.0.0.1:8000";

const PRIORITY_COLORS = {
  hod: "#e63946", professor: "#e07a5f",
  senior: "#6c63b6", self: "#40916c", other: "#6c757d"
};
const PRIORITY_ORDER = { hod: 1, professor: 2, senior: 3, self: 4, other: 4 };

const C = {
  bg: "#f7f3ee",
  paper: "#fffef9",
  ink: "#2c2438",
  faded: "#8a7f9a",
  lavender: "#b5a8d5",
  rose: "#e8b4bc",
  sage: "#a8c5b5",
  butter: "#f2d974",
  peach: "#f0b89a",
  sky: "#a8ccd7",
  border: "#e4ddd6",
  shadow: "rgba(44,36,56,0.08)",
};

const POSTIT_COLORS = [
  { bg: "#fef9c3", border: "#f5e642", rotate: "-1.2deg" },
  { bg: "#fce7f3", border: "#f9a8d4", rotate: "0.8deg" },
  { bg: "#dbeafe", border: "#93c5fd", rotate: "-0.5deg" },
  { bg: "#dcfce7", border: "#86efac", rotate: "1.1deg" },
  { bg: "#ede9fe", border: "#c4b5fd", rotate: "-0.9deg" },
  { bg: "#fee2e2", border: "#fca5a5", rotate: "0.6deg" },
];

const TABS = [
  { key: "dashboard", icon: LayoutDashboard, label: "Tasks" },
  { key: "add", icon: PlusCircle, label: "Add" },
  { key: "planner", icon: CalendarClock, label: "Planner" },
  { key: "code", icon: Code2, label: "Code" },
  { key: "docs", icon: FileText, label: "Docs" },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [assignments, setAssignments] = useState([]);
  const [planSections, setPlanSections] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [planStatus, setPlanStatus] = useState([]);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [githubData, setGithubData] = useState(null);
  const [emailModal, setEmailModal] = useState(null);
  const [code, setCode] = useState("# Start coding here\n");
  const [codeOutput, setCodeOutput] = useState("");
  const [codeRunning, setCodeRunning] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState({
    name: "", description: "", due: "", difficulty: 3,
    weight: 100, type: "code", linked_resource: "",
    resource_type: "github", recipient_type: "professor",
    professor_email: "",
  });
  const saveTimer = useRef(null);
  const bottomRef = useRef(null);

  const editor = useEditor({
    extensions: [StarterKit],
    content: "<p>Start writing here...</p>",
    onUpdate: ({ editor }) => {
      const words = editor.getText().split(/\s+/).filter(Boolean).length;
      setWordCount(words);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        if (selectedAssignment) {
          await fetch(`${API}/api/assignments/${selectedAssignment.id}/doc`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: editor.getHTML() })
          });
          const res = await fetch(`${API}/api/analyze-doc`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignment_id: selectedAssignment.id, doc_content: editor.getText() })
          });
          const data = await res.json();
          if (data.percent_complete !== undefined) {
            setSelectedAssignment(p => ({ ...p, progress_percent: data.percent_complete }));
            setAssignments(prev => prev.map(a =>
              a.id === selectedAssignment.id ? { ...a, progress_percent: data.percent_complete } : a
            ));
          }
        }
      }, 3000);
    },
  });

  useEffect(() => { fetchAssignments(); }, []);
  useEffect(() => {
    const synced = sessionStorage.getItem("calendarSynced");
    if (!synced) { syncCalendar(); sessionStorage.setItem("calendarSynced", "true"); }
  }, []);

  const syncCalendar = async () => {
    setSyncing(true);
    try { await fetch(`${API}/api/calendar-sync`); await fetchAssignments(); }
    catch (e) { console.error(e); }
    setSyncing(false);
  };

  const fetchAssignments = async () => {
    const res = await fetch(`${API}/api/assignments`);
    setAssignments(await res.json());
  };

  const addAssignment = async () => {
    if (!form.name || !form.due) return;
    await fetch(`${API}/api/assignments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    await fetchAssignments();
    setTab("dashboard");
    setForm({ name: "", description: "", due: "", difficulty: 3, weight: 100, type: "code", linked_resource: "", resource_type: "github", recipient_type: "professor", professor_email: "" });
  };

  const markDone = async (id) => {
    await fetch(`${API}/api/assignments/${id}?status=completed`, { method: "PATCH" });
    await fetchAssignments();
  };

  const openEditor = async (assignment) => {
    setSelectedAssignment(assignment);
    if (assignment.type === "github") {
      setTab("github"); setGithubData(null);
      const res = await fetch(`${API}/api/sync-github/${assignment.id}`, { method: "POST" });
      setGithubData(await res.json());
    } else if (assignment.type === "essay") {
      const res = await fetch(`${API}/api/assignments/${assignment.id}`);
      const data = await res.json();
      if (data.doc_content && editor) editor.commands.setContent(data.doc_content);
      setTab("docs");
    } else {
      const res = await fetch(`${API}/api/assignments/${assignment.id}`);
      const data = await res.json();
      setCode(data.code_content || "# Start coding here\n");
      setTab("code");
    }
  };

  const handleCodeChange = (value) => {
    setCode(value);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (selectedAssignment) {
        await fetch(`${API}/api/assignments/${selectedAssignment.id}/code`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: value })
        });
        const res = await fetch(`${API}/api/analyze-code`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignment_id: selectedAssignment.id, code_content: value })
        });
        const data = await res.json();
        if (data.percent_complete !== undefined) {
          setSelectedAssignment(p => ({ ...p, progress_percent: data.percent_complete }));
          setAssignments(prev => prev.map(a =>
            a.id === selectedAssignment.id ? { ...a, progress_percent: data.percent_complete } : a
          ));
        }
      }
    }, 3000);
  };

  const runCode = async () => {
    setCodeRunning(true); setCodeOutput("Running...");
    try {
      const res = await fetch(`${API}/api/run-code`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      setCodeOutput(data.output || data.error || "No output");
    } catch (e) { setCodeOutput("Connection error"); }
    finally { setCodeRunning(false); }
  };

  const parsePlanSections = (text) => {
    const sections = {};
    const names = ["Priority Order", "Time Estimates", "48-Hour Schedule", "Extension Recommendations", "Draft Messages"];
    names.forEach((name, i) => {
      const next = names[i + 1];
      const regex = next
        ? new RegExp(`##\\s*${name}([\\s\\S]*?)##\\s*${next}`)
        : new RegExp(`##\\s*${name}([\\s\\S]*?)$`);
      const match = text.match(regex);
      if (match) sections[name] = match[1].trim();
    });
    return sections;
  };

  const extractDraftMessages = (text) => {
    const messages = [];
    const draftSection = text.match(/##\s*Draft Messages([\s\S]*?)$/);
    if (!draftSection) return messages;
    const section = draftSection[1];
    const quotes = section.match(/>\s*"([\s\S]*?)"/g);
    if (!quotes) return messages;
    quotes.forEach(q => {
      const body = q.replace(/^>\s*"/, "").replace(/"$/, "").replace(/>\s*/g, "").trim();
      if (body.toLowerCase().startsWith("hey") || body.toLowerCase().startsWith("hi")) {
        messages.push({ type: "whatsapp", body, to: "" });
      } else if (body.toLowerCase().startsWith("dear")) {
        const subjectMatch = section.match(/Subject:\*?\*?\s*(.*)/);
        messages.push({ type: "email", subject: subjectMatch ? subjectMatch[1].replace(/\*\*/g, "").trim() : "Extension Request", body, to: "" });
      }
    });
    return messages;
  };

  const runPlanner = () => {
    setPlanSections(null); setPlanStatus([]); setPlanning(true);
    let fullText = "";
    const es = new EventSource(`${API}/api/plan-stream`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "done") {
          setPlanning(false); es.close();
          const sections = parsePlanSections(fullText);
          setPlanSections({ ...sections, extractedMessages: extractDraftMessages(fullText) });
          return;
        }
        if (data.type === "stream") fullText += data.content;
        if (data.type === "tool_start") setPlanStatus(p => [...p, data.content]);
      } catch (err) { }
    };
    es.onerror = () => { setPlanning(false); es.close(); };
  };

  const sendEmail = async () => {
    if (!emailModal.to) return alert("Enter recipient email");
    const res = await fetch(`${API}/api/send-email`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailModal),
    });
    const data = await res.json();
    if (data.status === "sent") { alert("Sent!"); setEmailModal(null); }
  };

  const getRisk = (due) => {
    const h = (new Date(due) - new Date()) / 36e5;
    if (h < 24) return { label: "Due Soon", color: "#e63946", bg: "#fff0f1" };
    if (h < 48) return { label: "High Risk", color: "#e07a5f", bg: "#fff4f0" };
    if (h < 96) return { label: "Moderate", color: "#6c63b6", bg: "#f0eefa" };
    return { label: "On Track", color: "#40916c", bg: "#f0faf5" };
  };

  const formatDue = (due) => new Date(due).toLocaleDateString("en-IN", {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });

  const strip = (t) => t?.replace(/\*\*/g, "").replace(/^\*+|^#+|^-+|\|/g, "").trim() || "";

  const sortedAssignments = [...assignments].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.recipient_type] || 4;
    const pb = PRIORITY_ORDER[b.recipient_type] || 4;
    return pa !== pb ? pa - pb : new Date(a.due) - new Date(b.due);
  });

  return (
    <div style={{ minHeight: "100vh", width: "100vw", background: C.bg, fontFamily: "'Lato', sans-serif", overflowX: "hidden" }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;600;700&family=Lato:wght@300;400;700&family=Playfair+Display:ital,wght@0,700;1,400&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { overflow-x: hidden; }
        .handwritten { font-family: 'Caveat', cursive; }
        .serif { font-family: 'Playfair Display', serif; }
        .postit {
          position: relative;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .postit::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 28px;
          background: rgba(0,0,0,0.06);
          border-radius: 4px 4px 0 0;
        }
        .postit:hover {
          transform: translateY(-3px) rotate(0deg) !important;
          box-shadow: 6px 10px 24px rgba(44,36,56,0.15) !important;
          z-index: 10;
        }
        .nav-item {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 18px; border-radius: 10px; border: none;
          cursor: pointer; font-size: 13px; font-weight: 600;
          font-family: 'Lato', sans-serif;
          transition: all 0.15s;
          letter-spacing: 0.3px;
        }
        .nav-item:hover { opacity: 0.85; transform: translateY(-1px); }
        .btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 16px; border-radius: 8px; border: none;
          cursor: pointer; font-size: 13px; font-weight: 700;
          font-family: 'Lato', sans-serif; letter-spacing: 0.3px;
          transition: all 0.15s; color: white;
        }
        .btn:hover { transform: translateY(-1px); filter: brightness(0.95); }
        .btn:active { transform: translateY(0); }
        .field {
          width: 100%; padding: 10px 14px;
          border: 1.5px solid ${C.border};
          border-radius: 10px; background: ${C.paper};
          font-size: 14px; color: ${C.ink}; outline: none;
          font-family: 'Lato', sans-serif;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .field:focus { border-color: ${C.lavender}; box-shadow: 0 0 0 3px rgba(181,168,213,0.15); }
        .card {
          background: ${C.paper};
          border-radius: 16px;
          border: 1px solid ${C.border};
          box-shadow: 0 2px 12px ${C.shadow};
        }
        .fade { animation: fadeUp 0.35s ease both; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .timeline-line { position: absolute; left: 11px; top: 24px; bottom: 0; width: 1.5px; background: linear-gradient(180deg, ${C.lavender}, ${C.sage}); }
        .ProseMirror { outline: none; min-height: 400px; font-size: 15px; line-height: 1.9; color: ${C.ink}; font-family: 'Lato', sans-serif; }
        .ProseMirror p { margin-bottom: 14px; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.lavender}; border-radius: 10px; }
        table { border-collapse: separate; border-spacing: 0 6px; }
        .pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; }
        input[type="range"] { accent-color: ${C.lavender}; width: 100%; }
      `}</style>

      {/* SIDEBAR NAV */}
      <div style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: 200, background: C.ink, display: "flex", flexDirection: "column", zIndex: 100, padding: "24px 16px" }}>
        
        {/* Logo */}
        <div style={{ marginBottom: 40, paddingLeft: 8 }}>
          <div className="handwritten" style={{ fontSize: 28, color: "white", fontWeight: 700, lineHeight: 1 }}>deadline.</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4, letterSpacing: 1, textTransform: "uppercase" }}>
            {syncing ? "syncing..." : "calendar synced"}
          </div>
        </div>

        {/* Nav items */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button key={t.key} className="nav-item" onClick={() => setTab(t.key)} style={{
                background: active ? "rgba(181,168,213,0.2)" : "transparent",
                color: active ? C.lavender : "rgba(255,255,255,0.55)",
                borderLeft: active ? `2px solid ${C.lavender}` : "2px solid transparent",
              }}>
                <Icon size={16} strokeWidth={active ? 2.5 : 1.8} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Bottom sync */}
        <button className="btn" onClick={syncCalendar} style={{ background: "rgba(255,255,255,0.08)", width: "100%", justifyContent: "center", fontSize: 12 }}>
          <RefreshCw size={13} />
          Sync Calendar
        </button>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ marginLeft: 200, minHeight: "100vh", padding: "36px 40px" }}>

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div className="fade">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 36 }}>
              <div>
                <div className="handwritten" style={{ fontSize: 42, color: C.ink, fontWeight: 700, lineHeight: 1 }}>my tasks</div>
                <div style={{ fontSize: 13, color: C.faded, marginTop: 6, letterSpacing: 0.3 }}>{assignments.length} active · sorted by priority</div>
              </div>
              <button className="btn" onClick={() => { setTab("planner"); runPlanner(); }} style={{ background: C.ink, padding: "10px 22px", fontSize: 13 }}>
                <Sparkles size={14} /> Plan My Week
              </button>
            </div>

            {assignments.length === 0 && (
              <div style={{ textAlign: "center", padding: "80px 0", color: C.faded }}>
                <BookOpen size={48} strokeWidth={1} style={{ marginBottom: 16, opacity: 0.3 }} />
                <div className="handwritten" style={{ fontSize: 24, marginBottom: 8 }}>all clear!</div>
                <div style={{ fontSize: 14 }}>no tasks yet — add one or sync your calendar</div>
              </div>
            )}

            {/* Post-it grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
              {sortedAssignments.map((a, idx) => {
                const risk = getRisk(a.due);
                const rc = PRIORITY_COLORS[a.recipient_type] || C.faded;
                const postit = POSTIT_COLORS[idx % POSTIT_COLORS.length];
                return (
                  <div key={a.id} className="postit" style={{
                    background: postit.bg,
                    border: `1.5px solid ${postit.border}`,
                    borderRadius: 4,
                    padding: "32px 20px 20px",
                    transform: `rotate(${postit.rotate})`,
                    boxShadow: `3px 6px 16px rgba(44,36,56,0.1)`,
                    position: "relative",
                  }}>
                    {/* Tape strip at top */}
                    <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", width: 60, height: 20, background: "rgba(255,255,255,0.6)", borderRadius: 2, backdropFilter: "blur(4px)", border: "1px solid rgba(255,255,255,0.8)" }} />
                    
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <div className="handwritten" style={{ fontSize: 20, color: C.ink, fontWeight: 700, lineHeight: 1.2, flex: 1 }}>{a.name}</div>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: rc, flexShrink: 0, marginLeft: 8, marginTop: 4 }} />
                    </div>

                    <div style={{ fontSize: 12, color: C.faded, marginBottom: 10, lineHeight: 1.5 }}>
                      {a.description?.slice(0, 70)}{a.description?.length > 70 ? "..." : ""}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
                      <span className="pill" style={{ background: risk.bg, color: risk.color }}>{risk.label}</span>
                      <span className="pill" style={{ background: "rgba(44,36,56,0.06)", color: C.faded }}>{a.recipient_type}</span>
                    </div>

                    <div className="handwritten" style={{ fontSize: 15, color: C.faded, marginBottom: 12 }}>
                      due {formatDue(a.due)}
                    </div>

                    {a.progress_percent > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.faded, marginBottom: 4 }}>
                          <span>progress</span>
                          <span className="handwritten" style={{ fontSize: 14, color: C.ink }}>{a.progress_percent}%</span>
                        </div>
                        <div style={{ background: "rgba(44,36,56,0.08)", borderRadius: 4, height: 4 }}>
                          <div style={{ background: rc, height: 4, borderRadius: 4, width: `${a.progress_percent}%`, transition: "width 0.6s" }} />
                        </div>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn" onClick={() => openEditor(a)} style={{ background: C.ink, fontSize: 12, padding: "6px 12px", flex: 1, justifyContent: "center" }}>
                        {a.type === "github" ? <Github size={12} /> : a.type === "essay" ? <FileText size={12} /> : <Code2 size={12} />}
                        Open
                      </button>
                      <button className="btn" onClick={() => markDone(a.id)} style={{ background: "#40916c", fontSize: 12, padding: "6px 12px" }}>
                        <CheckCircle size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ADD TASK */}
        {tab === "add" && (
          <div className="fade" style={{ maxWidth: 720 }}>
            <div className="handwritten" style={{ fontSize: 42, color: C.ink, fontWeight: 700, marginBottom: 8 }}>add new task</div>
            <div style={{ fontSize: 13, color: C.faded, marginBottom: 32 }}>paste requirements from WhatsApp or Teams so the AI knows what to track</div>

            <div className="card" style={{ padding: 36 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

                <div style={{ gridColumn: "1/-1" }}>
                  <label style={lbl}>Task Name</label>
                  <input className="field" placeholder="e.g. DBMS Assignment 3" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>

                <div style={{ gridColumn: "1/-1" }}>
                  <label style={lbl}>Description — paste exact requirements</label>
                  <textarea className="field" style={{ height: 110, resize: "vertical" }}
                    placeholder="The AI reads this to track your progress accurately..."
                    value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                </div>

                <div>
                  <label style={lbl}>Due Date & Time</label>
                  <input type="datetime-local" className="field" value={form.due} onChange={e => setForm({ ...form, due: e.target.value })} />
                </div>

                <div>
                  <label style={lbl}>Task Type</label>
                  <select className="field" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                    <option value="code">Code — in-app editor</option>
                    <option value="github">Code — GitHub repo</option>
                    <option value="essay">Essay / Report</option>
                    <option value="presentation">Presentation</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                {form.type === "github" && (
                  <div style={{ gridColumn: "1/-1" }}>
                    <label style={lbl}>GitHub Repo</label>
                    <input className="field" placeholder="username/repo-name" value={form.linked_resource} onChange={e => setForm({ ...form, linked_resource: e.target.value })} />
                  </div>
                )}

                <div>
                  <label style={lbl}>Assigned by</label>
                  <select className="field" value={form.recipient_type} onChange={e => setForm({ ...form, recipient_type: e.target.value })}>
                    <option value="hod">HOD — highest priority</option>
                    <option value="professor">Professor</option>
                    <option value="senior">Senior / TA</option>
                    <option value="self">Self / Personal</option>
                  </select>
                </div>

                <div>
                  <label style={lbl}>Their Email</label>
                  <input className="field" placeholder="prof@university.edu" value={form.professor_email} onChange={e => setForm({ ...form, professor_email: e.target.value })} />
                </div>

                <div>
                  <label style={lbl}>Difficulty — <span className="handwritten" style={{ fontSize: 16 }}>{"★".repeat(form.difficulty)}{"☆".repeat(5 - form.difficulty)}</span></label>
                  <input type="range" min="1" max="5" value={form.difficulty} onChange={e => setForm({ ...form, difficulty: parseInt(e.target.value) })} />
                </div>

                <div>
                  <label style={lbl}>Weight %</label>
                  <input type="number" className="field" placeholder="20" value={form.weight} onChange={e => setForm({ ...form, weight: parseInt(e.target.value) })} />
                </div>
              </div>

              <button className="btn" onClick={addAssignment} style={{ marginTop: 28, background: C.ink, width: "100%", justifyContent: "center", padding: "12px", fontSize: 14 }}>
                <PlusCircle size={15} /> Add Task
              </button>
            </div>
          </div>
        )}

        {/* AI PLANNER */}
        {tab === "planner" && (
          <div className="fade">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 32 }}>
              <div>
                <div className="handwritten" style={{ fontSize: 42, color: C.ink, fontWeight: 700, lineHeight: 1 }}>weekly plan</div>
                <div style={{ fontSize: 13, color: C.faded, marginTop: 6 }}>AI looks at everything together — priority, deadlines, real progress</div>
              </div>
              <button className="btn" onClick={runPlanner} disabled={planning} style={{ background: planning ? C.faded : C.ink, padding: "10px 24px" }}>
                {planning ? <><RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> Thinking...</> : <><Sparkles size={14} /> Plan My Week</>}
              </button>
            </div>

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

            {planning && (
              <div className="card" style={{ padding: 20, marginBottom: 20, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: C.faded, textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>Checking</span>
                {planStatus.map((s, i) => <span key={i} className="pill" style={{ background: "#f0eefa", color: "#6c63b6" }}>{s}</span>)}
              </div>
            )}

            {planSections && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

                {/* Priority Order — full width */}
                {planSections["Priority Order"] && (
                  <div className="card" style={{ padding: 28, gridColumn: "1/-1" }}>
                    <div className="handwritten" style={{ fontSize: 26, color: C.ink, marginBottom: 16, fontWeight: 700 }}>Priority Order</div>
                    {planSections["Priority Order"].split("\n").filter(l => l.trim()).map((line, i) => {
                      const text = strip(line).replace(/^\d+\.\s*/, "");
                      if (!text) return null;
                      const num = line.match(/^(\d+)\./)?.[1];
                      return (
                        <div key={i} style={{ display: "flex", gap: 14, padding: "12px 16px", background: C.bg, borderRadius: 10, marginBottom: 8, alignItems: "flex-start" }}>
                          {num && <span className="handwritten" style={{ fontSize: 22, color: C.lavender, fontWeight: 700, lineHeight: 1, flexShrink: 0, width: 24 }}>{num}</span>}
                          <span style={{ fontSize: 14, lineHeight: 1.6, color: C.ink }}>{text}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Time Estimates */}
                {planSections["Time Estimates"] && (
                  <div className="card" style={{ padding: 28 }}>
                    <div className="handwritten" style={{ fontSize: 26, color: C.ink, marginBottom: 16, fontWeight: 700 }}>Time Estimates</div>
                    <table style={{ width: "100%", fontSize: 13 }}>
                      <thead>
                        <tr>
                          {["Task", "Hours", "Left", "Risk"].map(h => (
                            <th key={h} style={{ textAlign: "left", padding: "4px 10px", color: C.faded, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {planSections["Time Estimates"].split("\n")
                          .filter(l => l.includes("|") && !l.includes("---") && !l.toLowerCase().includes("task"))
                          .map((line, i) => {
                            const cols = line.split("|").map(c => c.replace(/\*\*/g, "").trim()).filter(Boolean);
                            if (cols.length < 3) return null;
                            const isCrit = cols[3]?.toLowerCase().includes("critical");
                            const isHigh = cols[3]?.toLowerCase().includes("high");
                            const riskColor = isCrit ? "#e63946" : isHigh ? "#e07a5f" : "#40916c";
                            return (
                              <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                                <td style={{ padding: "10px", fontWeight: 700, color: C.ink }}>{cols[0]}</td>
                                <td style={{ padding: "10px", color: C.faded }}>{cols[1]}</td>
                                <td style={{ padding: "10px", color: C.faded }}>{cols[2]}</td>
                                <td style={{ padding: "10px" }}>
                                  <span className="pill" style={{ background: `${riskColor}15`, color: riskColor }}>{cols[3]}</span>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 48-Hour Schedule */}
                {planSections["48-Hour Schedule"] && (
                  <div className="card" style={{ padding: 28 }}>
                    <div className="handwritten" style={{ fontSize: 26, color: C.ink, marginBottom: 16, fontWeight: 700 }}>48-Hour Schedule</div>
                    <div style={{ position: "relative", paddingLeft: 28 }}>
                      <div className="timeline-line" />
                      {planSections["48-Hour Schedule"].split("\n").filter(l => l.trim()).map((line, i) => {
                        const text = strip(line).replace(/^\*\s*/, "");
                        if (!text) return null;
                        const isHeader = /friday|saturday|sunday|monday|today|tomorrow/i.test(text);
                        const isTime = /\d{1,2}:\d{2}/.test(text);
                        if (isHeader) return (
                          <div key={i} style={{ marginBottom: 10, marginTop: i > 0 ? 18 : 0 }}>
                            <span className="handwritten" style={{ fontSize: 18, color: C.lavender, fontWeight: 700 }}>{text}</span>
                          </div>
                        );
                        return (
                          <div key={i} style={{ position: "relative", marginBottom: 8 }}>
                            <div style={{ position: "absolute", left: -22, top: 8, width: 10, height: 10, borderRadius: "50%", background: isTime ? C.lavender : C.border, border: `2px solid ${C.paper}` }} />
                            <div style={{ padding: "8px 12px", background: isTime ? "#f5f2ff" : C.bg, borderRadius: 8, fontSize: 13, lineHeight: 1.5, fontWeight: isTime ? 700 : 400, color: isTime ? "#6c63b6" : C.ink, border: isTime ? "1px solid #e0d8f5" : "none" }}>
                              {text}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Extension Recommendations */}
                {planSections["Extension Recommendations"] && (
                  <div className="card" style={{ padding: 28 }}>
                    <div className="handwritten" style={{ fontSize: 26, color: C.ink, marginBottom: 16, fontWeight: 700 }}>Extensions</div>
                    {planSections["Extension Recommendations"].split("\n").filter(l => l.trim()).map((line, i) => {
                      const text = strip(line);
                      if (!text) return null;
                      return (
                        <div key={i} style={{ display: "flex", gap: 10, padding: "10px 14px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, marginBottom: 8, fontSize: 13, lineHeight: 1.6, alignItems: "flex-start" }}>
                          <AlertTriangle size={14} style={{ color: "#d97706", flexShrink: 0, marginTop: 2 }} />
                          <span style={{ color: C.ink }}>{text}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Draft Messages — full width */}
                {planSections.extractedMessages?.length > 0 && (
                  <div style={{ gridColumn: "1/-1" }}>
                    <div className="handwritten" style={{ fontSize: 32, color: C.ink, fontWeight: 700, marginBottom: 16 }}>Draft Messages</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                      {planSections.extractedMessages.map((msg, i) => (
                        <div key={i} className="card" style={{ overflow: "hidden" }}>
                          <div style={{ padding: "14px 18px", background: msg.type === "email" ? "#f5f2ff" : "#f0fdf4", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.border}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13, color: C.ink }}>
                              {msg.type === "email" ? <Mail size={14} /> : <Send size={14} />}
                              {msg.type === "email" ? "Email Draft" : "WhatsApp Message"}
                            </div>
                            {msg.type === "email" ? (
                              <button className="btn" onClick={() => setEmailModal(msg)} style={{ background: "#6c63b6", padding: "5px 12px", fontSize: 12 }}>
                                <Send size={11} /> Send
                              </button>
                            ) : (
                              <button className="btn" onClick={() => { navigator.clipboard.writeText(msg.body); alert("Copied!"); }} style={{ background: "#25d366", padding: "5px 12px", fontSize: 12 }}>
                                <Copy size={11} /> Copy
                              </button>
                            )}
                          </div>
                          {msg.subject && <div style={{ padding: "8px 18px", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.faded, fontWeight: 600 }}>Subject: {msg.subject}</div>}
                          <div style={{ padding: 18, fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.8, color: C.ink, maxHeight: 200, overflow: "auto" }}>{msg.body}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {/* GITHUB VIEW */}
        {tab === "github" && (
          <div className="fade" style={{ maxWidth: 800 }}>
            <div className="handwritten" style={{ fontSize: 42, color: C.ink, fontWeight: 700, marginBottom: 8 }}>GitHub Progress</div>
            {selectedAssignment && <div style={{ fontSize: 13, color: C.faded, marginBottom: 28 }}>{selectedAssignment.name} · {selectedAssignment.linked_resource}</div>}

            {!githubData ? (
              <div className="card" style={{ textAlign: "center", padding: 60, color: C.faded }}>
                <Github size={40} strokeWidth={1} style={{ marginBottom: 16, opacity: 0.3 }} />
                <div className="handwritten" style={{ fontSize: 20 }}>reading your repo...</div>
              </div>
            ) : (
              <div>
                <div className="card" style={{ padding: 32, marginBottom: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                    <div>
                      <div style={{ fontSize: 12, color: C.faded, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Completion</div>
                      <div className="handwritten" style={{ fontSize: 52, color: C.ink, fontWeight: 700, lineHeight: 1 }}>{githubData.percent_complete}%</div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 200 }}>
                      {[`${githubData.estimated_hours_remaining}h left`, `active ${githubData.last_active_hours_ago}h ago`, `${githubData.files_found} files`].map(s => (
                        <span key={s} className="pill" style={{ background: C.bg, color: C.faded }}>{s}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{ background: C.border, borderRadius: 6, height: 8, marginBottom: 20 }}>
                    <div style={{ background: `linear-gradient(90deg, ${C.lavender}, ${C.sky})`, height: 8, borderRadius: 6, width: `${githubData.percent_complete}%`, transition: "width 1s" }} />
                  </div>
                  <p style={{ color: C.faded, fontSize: 14, lineHeight: 1.7 }}>{githubData.assessment}</p>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                  {[
                    { label: "Completed", items: githubData.completed_parts, color: "#40916c", bg: "#f0faf5", empty: "nothing yet" },
                    { label: "Missing", items: githubData.missing_parts, color: "#e63946", bg: "#fff0f1", empty: "nothing missing!" }
                  ].map(({ label, items, color, bg, empty }) => (
                    <div key={label} className="card" style={{ padding: 24 }}>
                      <div className="handwritten" style={{ fontSize: 22, color, marginBottom: 14, fontWeight: 700 }}>{label}</div>
                      {(items || []).map((p, i) => (
                        <div key={i} style={{ padding: "6px 12px", background: bg, borderRadius: 8, marginBottom: 6, fontSize: 13, color: C.ink }}>{p}</div>
                      ))}
                      {!items?.length && <div style={{ color: C.faded, fontSize: 13 }}>{empty}</div>}
                    </div>
                  ))}
                </div>
                <button className="btn" onClick={() => openEditor(selectedAssignment)} style={{ background: C.ink }}>
                  <RotateCcw size={13} /> Refresh
                </button>
              </div>
            )}
          </div>
        )}

        {/* CODE EDITOR */}
        {tab === "code" && (
          <div className="fade">
            <div className="handwritten" style={{ fontSize: 42, color: C.ink, fontWeight: 700, marginBottom: 24 }}>code editor</div>
            <div className="card" style={{ overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bg }}>
                <div>
                  {selectedAssignment
                    ? <span style={{ fontWeight: 700, color: C.ink, fontSize: 14 }}>{selectedAssignment.name} <span style={{ color: C.faded, fontWeight: 400 }}>· {selectedAssignment.progress_percent || 0}% complete</span></span>
                    : <select className="field" style={{ width: "auto" }} onChange={e => { const a = assignments.find(a => a.id === parseInt(e.target.value)); if (a) openEditor(a); }}>
                        <option value="">Link to task...</option>
                        {assignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                  }
                </div>
                <button className="btn" onClick={runCode} disabled={codeRunning} style={{ background: codeRunning ? C.faded : C.ink }}>
                  {codeRunning ? <RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Cpu size={13} />}
                  {codeRunning ? "Running..." : "Run"}
                </button>
              </div>
              <Editor key={selectedAssignment?.id || "default"} height="62vh" defaultLanguage="python" value={code} onChange={handleCodeChange} theme="vs-dark" options={{ fontSize: 14, minimap: { enabled: false }, padding: { top: 20 }, fontFamily: "JetBrains Mono, Fira Code, monospace" }} />
              {codeOutput && (
                <div style={{ background: "#1a1625", color: "#c9b8e8", padding: "14px 20px", fontFamily: "JetBrains Mono, monospace", fontSize: 13, maxHeight: 160, overflow: "auto", borderTop: "2px solid #2d2040" }}>
                  <div style={{ color: "#6c5a9e", marginBottom: 8, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>output</div>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{codeOutput}</pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* DOCS EDITOR */}
        {tab === "docs" && (
          <div className="fade">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
              <div className="handwritten" style={{ fontSize: 42, color: C.ink, fontWeight: 700 }}>document editor</div>
              <span className="pill" style={{ background: C.bg, color: C.faded, fontSize: 12 }}>{wordCount} words</span>
            </div>
            <div className="card" style={{ overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bg }}>
                {selectedAssignment
                  ? <span style={{ fontWeight: 700, color: C.ink, fontSize: 14 }}>{selectedAssignment.name} <span style={{ color: C.faded, fontWeight: 400 }}>· {selectedAssignment.progress_percent || 0}% complete</span></span>
                  : <select className="field" style={{ width: "auto" }} onChange={e => { const a = assignments.find(a => a.id === parseInt(e.target.value)); if (a) openEditor(a); }}>
                      <option value="">Link to task...</option>
                      {assignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                }
              </div>
              <div style={{ padding: 32, minHeight: "65vh", background: C.paper }}>
                <EditorContent editor={editor} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* EMAIL MODAL */}
      {emailModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(44,36,56,0.5)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div className="card fade" style={{ padding: 36, width: 560, maxHeight: "85vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div className="handwritten" style={{ fontSize: 28, color: C.ink, fontWeight: 700 }}>Review & Send</div>
              <button onClick={() => setEmailModal(null)} style={{ background: "none", border: "none", cursor: "pointer", color: C.faded }}><X size={20} /></button>
            </div>
            {[["To", "to", "professor@university.edu"], ["Subject", "subject", "Extension Request"]].map(([label, key, ph]) => (
              <div key={key} style={{ marginBottom: 16 }}>
                <label style={lbl}>{label}</label>
                <input className="field" value={emailModal[key] || ""} onChange={e => setEmailModal({ ...emailModal, [key]: e.target.value })} placeholder={ph} />
              </div>
            ))}
            <div style={{ marginBottom: 24 }}>
              <label style={lbl}>Body</label>
              <textarea className="field" style={{ height: 200, resize: "vertical" }} value={emailModal.body || ""} onChange={e => setEmailModal({ ...emailModal, body: e.target.value })} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" onClick={sendEmail} style={{ background: C.ink, flex: 1, justifyContent: "center", padding: "10px" }}>
                <Send size={13} /> Send Email
              </button>
              <button className="btn" onClick={() => { navigator.clipboard.writeText(emailModal.body || ""); alert("Copied!"); }} style={{ background: "#25d366", flex: 1, justifyContent: "center", padding: "10px" }}>
                <Copy size={13} /> Copy for WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const lbl = { display: "block", marginBottom: 6, fontWeight: 700, fontSize: 12, color: "#8a7f9a", textTransform: "uppercase", letterSpacing: 0.5 };