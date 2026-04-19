import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "data.db"
STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/dashboard.html": "dashboard.html",
    "/pricing.html": "pricing.html",
    "/styles.css": "styles.css",
    "/script.js": "script.js",
}

def load_env_file():
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file()

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-in-production")
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
APP_URL = os.getenv("APP_URL", "http://localhost:8000")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@launchpad.local").lower().strip()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "Admin!1234")


LOCAL_JOBS = [
    {
        "title": "IT Support Analyst I",
        "company": "NorthBridge Health",
        "location": "Remote",
        "type": "entry-level",
        "track": "it",
        "skills": ["troubleshooting", "active directory", "windows", "ticketing"],
    },
    {
        "title": "Cybersecurity Intern",
        "company": "Blue Arc Systems",
        "location": "New York, NY",
        "type": "internship",
        "track": "cybersecurity",
        "skills": ["siem", "splunk", "incident response", "networking"],
    },
    {
        "title": "Junior SOC Analyst",
        "company": "SecureGrid",
        "location": "Dallas, TX",
        "type": "entry-level",
        "track": "cybersecurity",
        "skills": ["siem", "linux", "threat detection", "python"],
    },
    {
        "title": "QA Automation Intern",
        "company": "Nimbus Software",
        "location": "Remote",
        "type": "internship",
        "track": "software",
        "skills": ["python", "testing", "git", "api"],
    },
    {
        "title": "Junior Data Analyst",
        "company": "Atlas Retail",
        "location": "Chicago, IL",
        "type": "entry-level",
        "track": "data",
        "skills": ["sql", "excel", "power bi", "dashboard"],
    },
    {
        "title": "Cloud Operations Associate",
        "company": "Northstar Cloud",
        "location": "Remote",
        "type": "entry-level",
        "track": "cloud",
        "skills": ["aws", "linux", "scripting", "monitoring"],
    },
]


STOP_WORDS = {
    "the",
    "and",
    "with",
    "for",
    "that",
    "from",
    "your",
    "this",
    "have",
    "will",
    "you",
    "our",
    "job",
    "role",
    "team",
    "a",
    "an",
    "to",
    "in",
    "on",
    "of",
    "or",
    "is",
    "as",
}


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def now_iso():
    return datetime.utcnow().isoformat() + "Z"


def init_db():
    conn = db()
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            plan TEXT NOT NULL DEFAULT 'starter',
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS saved_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            company TEXT NOT NULL,
            location TEXT,
            job_type TEXT,
            track TEXT,
            url TEXT,
            fit_score INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            company TEXT NOT NULL,
            role TEXT NOT NULL,
            stage TEXT NOT NULL,
            app_date TEXT,
            notes TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS ats_analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            score INTEGER NOT NULL,
            matched_keywords TEXT,
            missing_keywords TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            stripe_customer_id TEXT,
            stripe_subscription_id TEXT,
            plan TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        """
    )
    conn.commit()
    create_or_update_admin(conn)
    conn.close()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, packed: str) -> bool:
    try:
        salt, digest_hex = packed.split("$", 1)
    except ValueError:
        return False
    trial = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000).hex()
    return hmac.compare_digest(trial, digest_hex)


def b64url(data: bytes) -> bytes:
    return base64.urlsafe_b64encode(data).rstrip(b"=")


def make_token(payload: dict) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = payload.copy()
    payload["exp"] = int(time.time()) + 60 * 60 * 12
    h = b64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    p = b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(JWT_SECRET.encode("utf-8"), h + b"." + p, hashlib.sha256).digest()
    s = b64url(signature)
    return (h + b"." + p + b"." + s).decode("utf-8")


def parse_token(token: str):
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
        signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
        expected = b64url(hmac.new(JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256).digest()).decode("utf-8")
        if not hmac.compare_digest(expected, sig_b64):
            return None
        padded = payload_b64 + "=" * ((4 - len(payload_b64) % 4) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8"))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def create_or_update_admin(conn):
    cur = conn.cursor()
    cur.execute("SELECT id, email FROM users WHERE email = ?", (ADMIN_EMAIL,))
    row = cur.fetchone()
    hashed = hash_password(ADMIN_PASSWORD)
    if row:
        cur.execute(
            "UPDATE users SET password_hash = ?, is_admin = 1 WHERE id = ?",
            (hashed, row["id"]),
        )
    else:
        cur.execute(
            "INSERT INTO users (name, email, password_hash, plan, is_admin, created_at) VALUES (?, ?, ?, 'accelerator', 1, ?)",
            ("Admin", ADMIN_EMAIL, hashed, now_iso()),
        )
    conn.commit()


def read_json_body(handler: BaseHTTPRequestHandler):
    length = int(handler.headers.get("Content-Length", 0))
    raw = handler.rfile.read(length) if length > 0 else b"{}"
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {}


def write_json(handler: BaseHTTPRequestHandler, code: int, data: dict):
    body = json.dumps(data).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, Stripe-Signature")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


def tokenize(text: str):
    tokens = []
    word = []
    for ch in text.lower():
        if ch.isalnum() or ch in ["+", "#", "."]:
            word.append(ch)
        else:
            if word:
                token = "".join(word)
                if len(token) > 2 and token not in STOP_WORDS:
                    tokens.append(token)
                word = []
    if word:
        token = "".join(word)
        if len(token) > 2 and token not in STOP_WORDS:
            tokens.append(token)
    return sorted(list(set(tokens)))


def infer_track(text: str):
    t = text.lower()
    if "cyber" in t or "soc" in t or "security" in t:
        return "cybersecurity"
    if "devops" in t or "cloud" in t or "aws" in t or "azure" in t:
        return "cloud"
    if "data" in t or "sql" in t or "analyst" in t:
        return "data"
    if "software" in t or "developer" in t or "qa" in t:
        return "software"
    return "it"


def infer_type(text: str):
    t = text.lower()
    if "intern" in t:
        return "internship"
    if "entry" in t or "junior" in t or "associate" in t or "new grad" in t:
        return "entry-level"
    return "entry-level"


def infer_skills(text: str):
    values = [
        "python",
        "javascript",
        "sql",
        "linux",
        "aws",
        "azure",
        "siem",
        "splunk",
        "active directory",
        "ticketing",
        "excel",
        "power bi",
        "api",
        "networking",
    ]
    tl = text.lower()
    return [skill for skill in values if skill in tl]


def normalize_remote_job(item: dict):
    title = item.get("title") or "Unknown title"
    desc = item.get("description") or ""
    return {
        "title": title,
        "company": item.get("company_name") or item.get("company") or "Unknown",
        "location": item.get("candidate_required_location") or item.get("location") or "Remote",
        "type": infer_type(title + " " + desc),
        "track": infer_track(title + " " + desc),
        "skills": infer_skills(desc),
        "url": item.get("url", ""),
    }


def fetch_json(url: str, timeout: int = 6):
    req = urllib.request.Request(url, headers={"User-Agent": "launchpad-tech-jobs/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_live_jobs():
    jobs = []
    try:
        rem = fetch_json("https://remotive.com/api/remote-jobs")
        for item in rem.get("jobs", [])[:60]:
            jobs.append(normalize_remote_job(item))
    except Exception:
        pass
    try:
        arb = fetch_json("https://www.arbeitnow.com/api/job-board-api")
        for item in arb.get("data", [])[:60]:
            jobs.append(normalize_remote_job(item))
    except Exception:
        pass
    return jobs


def score_job(job: dict, user_skills: list, location_pref: str):
    job_skills = [s.lower() for s in job.get("skills", [])]
    match_count = 0
    for skill in user_skills:
        if any(skill in s or s in skill for s in job_skills):
            match_count += 1
    score = match_count * 22
    if not location_pref or location_pref in job.get("location", "").lower():
        score += 14
    score = min(100, score)
    payload = dict(job)
    payload["score"] = score
    payload["matchCount"] = match_count
    return payload


def get_user_from_auth(handler: BaseHTTPRequestHandler):
    header = handler.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    payload = parse_token(header.split(" ", 1)[1].strip())
    if not payload:
        return None
    user_id = payload.get("uid")
    if not user_id:
        return None
    conn = db()
    cur = conn.cursor()
    cur.execute("SELECT id, name, email, plan, is_admin FROM users WHERE id = ?", (user_id,))
    user = cur.fetchone()
    conn.close()
    return user


class AppHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, Stripe-Signature")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path in STATIC_FILES:
            return self.serve_static(STATIC_FILES[path])

        if path == "/api/health":
            return write_json(self, 200, {"ok": True, "time": now_iso()})

        if path == "/api/auth/me":
            user = get_user_from_auth(self)
            if not user:
                return write_json(self, 401, {"error": "Unauthorized"})
            return write_json(
                self,
                200,
                {
                    "user": {
                        "id": user["id"],
                        "name": user["name"],
                        "email": user["email"],
                        "plan": user["plan"],
                        "isAdmin": bool(user["is_admin"]),
                    }
                },
            )

        if path == "/api/jobs/search":
            query = urllib.parse.parse_qs(parsed.query)
            source = query.get("source", ["live"])[0]
            job_type = query.get("jobType", ["all"])[0]
            track = query.get("track", ["all"])[0]
            location = query.get("location", [""])[0].lower().strip()
            skills = query.get("skills", [""])[0].lower().strip()
            user_skills = sorted([s.strip() for s in skills.split(",") if s.strip()])

            jobs = list(LOCAL_JOBS)
            if source == "live":
                jobs.extend(fetch_live_jobs())

            if job_type != "all":
                jobs = [job for job in jobs if job.get("type") == job_type]
            if track != "all":
                jobs = [job for job in jobs if job.get("track") == track]

            scored = [score_job(job, user_skills, location) for job in jobs]
            scored.sort(key=lambda item: item.get("score", 0), reverse=True)
            return write_json(self, 200, {"jobs": scored[:300]})

        if path == "/api/saved-jobs":
            user = get_user_from_auth(self)
            if not user:
                return write_json(self, 401, {"error": "Unauthorized"})
            conn = db()
            cur = conn.cursor()
            cur.execute(
                "SELECT id, title, company, location, job_type, track, url, fit_score, created_at FROM saved_jobs WHERE user_id = ? ORDER BY id DESC",
                (user["id"],),
            )
            items = [dict(row) for row in cur.fetchall()]
            conn.close()
            return write_json(self, 200, {"savedJobs": items})

        if path == "/api/applications":
            user = get_user_from_auth(self)
            if not user:
                return write_json(self, 401, {"error": "Unauthorized"})
            conn = db()
            cur = conn.cursor()
            cur.execute(
                "SELECT id, company, role, stage, app_date, notes, created_at FROM applications WHERE user_id = ? ORDER BY id DESC",
                (user["id"],),
            )
            items = [dict(row) for row in cur.fetchall()]
            conn.close()
            return write_json(self, 200, {"applications": items})

        if path == "/api/admin/analytics":
            user = get_user_from_auth(self)
            if not user or not user["is_admin"]:
                return write_json(self, 403, {"error": "Admin access required"})
            conn = db()
            cur = conn.cursor()
            total_users = cur.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
            total_saved_jobs = cur.execute("SELECT COUNT(*) AS c FROM saved_jobs").fetchone()["c"]
            total_applications = cur.execute("SELECT COUNT(*) AS c FROM applications").fetchone()["c"]
            total_ats = cur.execute("SELECT COUNT(*) AS c FROM ats_analyses").fetchone()["c"]
            plan_breakdown = [
                dict(row)
                for row in cur.execute(
                    "SELECT plan, COUNT(*) AS count FROM users GROUP BY plan ORDER BY count DESC"
                ).fetchall()
            ]
            stage_breakdown = [
                dict(row)
                for row in cur.execute(
                    "SELECT stage, COUNT(*) AS count FROM applications GROUP BY stage ORDER BY count DESC"
                ).fetchall()
            ]
            conn.close()
            return write_json(
                self,
                200,
                {
                    "analytics": {
                        "totalUsers": total_users,
                        "totalSavedJobs": total_saved_jobs,
                        "totalApplications": total_applications,
                        "totalAtsAnalyses": total_ats,
                        "planBreakdown": plan_breakdown,
                        "stageBreakdown": stage_breakdown,
                    }
                },
            )

        write_json(self, 404, {"error": "Not found"})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path

        if path == "/api/auth/signup":
            data = read_json_body(self)
            name = str(data.get("name", "")).strip()
            email = str(data.get("email", "")).strip().lower()
            password = str(data.get("password", "")).strip()

            if len(name) < 2 or "@" not in email or len(password) < 8:
                return write_json(self, 400, {"error": "Invalid signup fields"})

            conn = db()
            cur = conn.cursor()
            try:
                cur.execute(
                    "INSERT INTO users (name, email, password_hash, plan, is_admin, created_at) VALUES (?, ?, ?, 'starter', 0, ?)",
                    (name, email, hash_password(password), now_iso()),
                )
                conn.commit()
                user_id = cur.lastrowid
            except sqlite3.IntegrityError:
                conn.close()
                return write_json(self, 409, {"error": "Email already registered"})
            conn.close()

            token = make_token({"uid": user_id, "email": email})
            return write_json(
                self, 201, {"token": token, "user": {"id": user_id, "name": name, "email": email, "plan": "starter"}}
            )

        if path == "/api/auth/login":
            data = read_json_body(self)
            email = str(data.get("email", "")).strip().lower()
            password = str(data.get("password", "")).strip()
            conn = db()
            cur = conn.cursor()
            cur.execute("SELECT id, name, email, password_hash, plan, is_admin FROM users WHERE email = ?", (email,))
            row = cur.fetchone()
            conn.close()
            if not row or not verify_password(password, row["password_hash"]):
                return write_json(self, 401, {"error": "Invalid email or password"})
            token = make_token({"uid": row["id"], "email": row["email"]})
            return write_json(
                self,
                200,
                {
                    "token": token,
                    "user": {
                        "id": row["id"],
                        "name": row["name"],
                        "email": row["email"],
                        "plan": row["plan"],
                        "isAdmin": bool(row["is_admin"]),
                    },
                },
            )

        if path == "/api/resume/analyze":
            user = get_user_from_auth(self)
            if not user:
                return write_json(self, 401, {"error": "Unauthorized"})
            data = read_json_body(self)
            resume_text = str(data.get("resumeText", "")).strip()
            job_desc = str(data.get("jobDescText", "")).strip()
            if not resume_text or not job_desc:
                return write_json(self, 400, {"error": "Resume text and job description are required"})

            resume_terms = tokenize(resume_text)
            job_terms = tokenize(job_desc)
            resume_set = set(resume_terms)
            matched = [term for term in job_terms if term in resume_set]
            missing = [term for term in job_terms if term not in resume_set]
            score = round((len(matched) / max(len(job_terms), 1)) * 100)

            suggestions = [
                "Mirror the target role title near your resume summary.",
                "Add a Core Skills section that reflects top job keywords.",
                "Include quantified outcomes (ticket volume, response time, uptime).",
                "Use ATS-friendly formatting: simple headings, no text boxes.",
                "Move certifications and relevant projects closer to the top.",
            ]

            conn = db()
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO ats_analyses (user_id, score, matched_keywords, missing_keywords, created_at) VALUES (?, ?, ?, ?, ?)",
                (user["id"], score, ",".join(matched[:50]), ",".join(missing[:50]), now_iso()),
            )
            conn.commit()
            conn.close()

            return write_json(
                self,
                200,
                {
                    "score": score,
                    "matchedKeywords": matched[:20],
                    "missingKeywords": missing[:20],
                    "suggestions": suggestions,
                },
            )

        if path == "/api/saved-jobs":
            user = get_user_from_auth(self)
            if not user:
                return write_json(self, 401, {"error": "Unauthorized"})
            data = read_json_body(self)
            title = str(data.get("title", "")).strip()
            company = str(data.get("company", "")).strip()
            if not title or not company:
                return write_json(self, 400, {"error": "title and company are required"})
            conn = db()
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO saved_jobs (user_id, title, company, location, job_type, track, url, fit_score, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user["id"],
                    title,
                    company,
                    str(data.get("location", "")).strip(),
                    str(data.get("type", "")).strip(),
                    str(data.get("track", "")).strip(),
                    str(data.get("url", "")).strip(),
                    int(data.get("score", 0)),
                    now_iso(),
                ),
            )
            conn.commit()
            job_id = cur.lastrowid
            conn.close()
            return write_json(self, 201, {"savedJobId": job_id})

        if path == "/api/applications":
            user = get_user_from_auth(self)
            if not user:
                return write_json(self, 401, {"error": "Unauthorized"})
            data = read_json_body(self)
            company = str(data.get("company", "")).strip()
            role = str(data.get("role", "")).strip()
            stage = str(data.get("stage", "")).strip() or "Applied"
            app_date = str(data.get("date", "")).strip()
            notes = str(data.get("notes", "")).strip()
            if not company or not role:
                return write_json(self, 400, {"error": "company and role are required"})
            conn = db()
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO applications (user_id, company, role, stage, app_date, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user["id"], company, role, stage, app_date, notes, now_iso()),
            )
            conn.commit()
            app_id = cur.lastrowid
            conn.close()
            return write_json(self, 201, {"applicationId": app_id})

        if path == "/api/stripe/create-checkout-session":
            user = get_user_from_auth(self)
            if not user:
                return write_json(self, 401, {"error": "Unauthorized"})
            data = read_json_body(self)
            plan = str(data.get("plan", "starter")).strip().lower()
            if plan not in {"starter", "momentum", "accelerator"}:
                return write_json(self, 400, {"error": "Invalid plan"})
            if not STRIPE_SECRET_KEY:
                conn = db()
                cur = conn.cursor()
                cur.execute("UPDATE users SET plan = ? WHERE id = ?", (plan, user["id"]))
                conn.commit()
                conn.close()
                return write_json(
                    self,
                    200,
                    {
                        "checkoutUrl": "",
                        "message": "Stripe is not configured. Plan updated in local development mode.",
                    },
                )

            # Requires STRIPE price IDs set in environment.
            price_ids = {
                "starter": os.getenv("STRIPE_PRICE_STARTER", ""),
                "momentum": os.getenv("STRIPE_PRICE_MOMENTUM", ""),
                "accelerator": os.getenv("STRIPE_PRICE_ACCELERATOR", ""),
            }
            price_id = price_ids.get(plan, "")
            if not price_id:
                return write_json(self, 400, {"error": f"Missing Stripe price ID for {plan}"})

            payload = urllib.parse.urlencode(
                {
                    "mode": "subscription",
                    "success_url": f"{APP_URL}/?checkout=success",
                    "cancel_url": f"{APP_URL}/?checkout=cancel",
                    "line_items[0][price]": price_id,
                    "line_items[0][quantity]": "1",
                    "metadata[user_id]": str(user["id"]),
                    "metadata[plan]": plan,
                }
            ).encode("utf-8")
            request = urllib.request.Request(
                "https://api.stripe.com/v1/checkout/sessions",
                data=payload,
                headers={
                    "Authorization": f"Bearer {STRIPE_SECRET_KEY}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    body = json.loads(response.read().decode("utf-8"))
                    return write_json(self, 200, {"checkoutUrl": body.get("url", "")})
            except Exception as exc:
                return write_json(self, 500, {"error": f"Stripe checkout error: {exc}"})

        if path == "/api/stripe/webhook":
            raw_len = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(raw_len) if raw_len > 0 else b""
            sig_header = self.headers.get("Stripe-Signature", "")
            if not STRIPE_WEBHOOK_SECRET:
                return write_json(self, 200, {"received": True, "note": "No webhook secret configured"})
            if not self.verify_stripe_signature(sig_header, raw):
                return write_json(self, 400, {"error": "Invalid Stripe signature"})
            try:
                event = json.loads(raw.decode("utf-8"))
            except Exception:
                return write_json(self, 400, {"error": "Invalid event payload"})
            self.handle_stripe_event(event)
            return write_json(self, 200, {"received": True})

        write_json(self, 404, {"error": "Not found"})

    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path
        user = get_user_from_auth(self)
        if not user:
            return write_json(self, 401, {"error": "Unauthorized"})

        if path.startswith("/api/saved-jobs/"):
            job_id = path.rsplit("/", 1)[-1]
            conn = db()
            cur = conn.cursor()
            cur.execute("DELETE FROM saved_jobs WHERE id = ? AND user_id = ?", (job_id, user["id"]))
            conn.commit()
            conn.close()
            return write_json(self, 200, {"deleted": True})

        if path.startswith("/api/applications/"):
            app_id = path.rsplit("/", 1)[-1]
            conn = db()
            cur = conn.cursor()
            cur.execute("DELETE FROM applications WHERE id = ? AND user_id = ?", (app_id, user["id"]))
            conn.commit()
            conn.close()
            return write_json(self, 200, {"deleted": True})

        write_json(self, 404, {"error": "Not found"})

    def serve_static(self, filename: str):
        file_path = BASE_DIR / filename
        if not file_path.exists() or not file_path.is_file():
            return write_json(self, 404, {"error": "Static file not found"})
        data = file_path.read_bytes()
        content_type = "text/plain"
        if filename.endswith(".html"):
            content_type = "text/html; charset=utf-8"
        elif filename.endswith(".css"):
            content_type = "text/css; charset=utf-8"
        elif filename.endswith(".js"):
            content_type = "application/javascript; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def verify_stripe_signature(self, signature_header: str, payload: bytes):
        try:
            parts = {}
            for part in signature_header.split(","):
                k, v = part.split("=", 1)
                parts[k] = v
            timestamp = parts.get("t", "")
            signature = parts.get("v1", "")
            signed = f"{timestamp}.{payload.decode('utf-8')}".encode("utf-8")
            expected = hmac.new(STRIPE_WEBHOOK_SECRET.encode("utf-8"), signed, hashlib.sha256).hexdigest()
            return hmac.compare_digest(expected, signature)
        except Exception:
            return False

    def handle_stripe_event(self, event: dict):
        event_type = event.get("type")
        obj = event.get("data", {}).get("object", {})
        metadata = obj.get("metadata", {})
        user_id = metadata.get("user_id")
        plan = metadata.get("plan", "starter")
        if event_type in {"checkout.session.completed", "customer.subscription.updated"} and user_id:
            conn = db()
            cur = conn.cursor()
            cur.execute("UPDATE users SET plan = ? WHERE id = ?", (plan, user_id))
            cur.execute(
                """
                INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    obj.get("customer", ""),
                    obj.get("subscription", ""),
                    plan,
                    "active",
                    now_iso(),
                    now_iso(),
                ),
            )
            conn.commit()
            conn.close()


def run():
    init_db()
    port = int(os.getenv("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), AppHandler)
    print(f"Launchpad server running at {APP_URL} (port {port})")
    server.serve_forever()


if __name__ == "__main__":
    run()
