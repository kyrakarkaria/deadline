import asyncpg
import os
from dotenv import load_dotenv

load_dotenv(dotenv_path="../.env")

DATABASE_URL = os.getenv("DATABASE_URL")

async def get_connection():
    return await asyncpg.connect(DATABASE_URL)

async def create_tables():
    conn = await get_connection()
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS assignments (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            due TIMESTAMP WITH TIME ZONE,
            difficulty INT DEFAULT 3,
            weight INT DEFAULT 100,
            type VARCHAR(50) DEFAULT 'code',
            linked_resource VARCHAR(500),
            resource_type VARCHAR(50),
            status VARCHAR(50) DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS agent_decisions (
            id SERIAL PRIMARY KEY,
            assignment_name VARCHAR(255),
            decision TEXT,
            reasoning TEXT,
            email_draft TEXT,
            outcome VARCHAR(50) DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS professor_patterns (
            id SERIAL PRIMARY KEY,
            professor_name VARCHAR(255),
            extension_granted BOOLEAN,
            days_requested INT,
            reason_used TEXT,
            response_time_hours INT,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS study_sessions (
            id SERIAL PRIMARY KEY,
            assignment_name VARCHAR(255),
            planned_hours FLOAT,
            actual_hours FLOAT,
            date DATE DEFAULT CURRENT_DATE,
            notes TEXT
        );
    """)
    await conn.close()
    print("Tables created successfully")

async def save_decision(assignment_name: str, decision: str, reasoning: str, email_draft: str = ""):
    conn = await get_connection()
    await conn.execute("""
        INSERT INTO agent_decisions (assignment_name, decision, reasoning, email_draft)
        VALUES ($1, $2, $3, $4)
    """, assignment_name, decision, reasoning, email_draft)
    await conn.close()

async def get_past_decisions(assignment_name: str) -> list:
    conn = await get_connection()
    rows = await conn.fetch("""
        SELECT * FROM agent_decisions
        WHERE assignment_name ILIKE $1
        ORDER BY created_at DESC LIMIT 5
    """, f"%{assignment_name}%")
    await conn.close()
    return [dict(row) for row in rows]

async def save_professor_pattern(professor: str, granted: bool, days: int, reason: str):
    conn = await get_connection()
    await conn.execute("""
        INSERT INTO professor_patterns (professor_name, extension_granted, days_requested, reason_used)
        VALUES ($1, $2, $3, $4)
    """, professor, granted, days, reason)
    await conn.close()

async def get_professor_patterns(professor: str) -> list:
    conn = await get_connection()
    rows = await conn.fetch("""
        SELECT * FROM professor_patterns
        WHERE professor_name ILIKE $1
        ORDER BY created_at DESC LIMIT 10
    """, f"%{professor}%")
    await conn.close()
    return [dict(row) for row in rows]

async def save_assignment(name: str, description: str, due: str,
                          difficulty: int, weight: int, type: str,
                          linked_resource: str, resource_type: str) -> int:
    from datetime import datetime
    # Parse the datetime string from the frontend
    due_dt = datetime.fromisoformat(due)
    
    conn = await get_connection()
    row = await conn.fetchrow("""
        INSERT INTO assignments (name, description, due, difficulty, weight, type, linked_resource, resource_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
    """, name, description, due_dt, difficulty, weight, type, linked_resource, resource_type)
    await conn.close()
    return row["id"]

async def get_all_assignments() -> list:
    conn = await get_connection()
    rows = await conn.fetch("""
        SELECT * FROM assignments
        WHERE status != 'completed'
        ORDER BY due ASC
    """)
    await conn.close()
    return [dict(row) for row in rows]

async def update_assignment_status(assignment_id: int, status: str):
    conn = await get_connection()
    await conn.execute("""
        UPDATE assignments SET status = $1 WHERE id = $2
    """, status, assignment_id)
    await conn.close()

if __name__ == "__main__":
    import asyncio
    asyncio.run(create_tables())