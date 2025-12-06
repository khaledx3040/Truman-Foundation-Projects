from flask import Flask, request, jsonify
from flask_cors import CORS, cross_origin
from datetime import datetime
import uuid

from db import init_db, get_connection

app = Flask(__name__)
# Allow all origins for now (dev only)
CORS(app, resources={r"/*": {"origins": "*"}})

# Initialise DB at startup
init_db()


@app.route("/events", methods=["POST", "OPTIONS"])
@cross_origin()
def log_event():
    if request.method == "OPTIONS":
        # preflight will hit this
        return jsonify({"status": "ok"}), 200

    data = request.get_json(force=True)

    session_id = data.get("session_id") or str(uuid.uuid4())
    event_type = data.get("event_type")
    element_id = data.get("element_id")
    scroll_depth = data.get("scroll_depth")
    reaction_type = data.get("reaction_type")  # New field from frontend
    timestamp = data.get("timestamp") or datetime.utcnow().isoformat()

    if not event_type:
        return jsonify({"error": "event_type is required"}), 400

    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO events (session_id, event_type, element_id, scroll_depth, reaction_type, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (session_id, event_type, element_id, scroll_depth, reaction_type, timestamp),
    )
    conn.commit()
    conn.close()

    return jsonify({"status": "ok", "session_id": session_id}), 201


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/admin/debug", methods=["GET"])
def admin_debug():
    """Debug endpoint to inspect database contents."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        
        # Get total event count
        cur.execute("SELECT COUNT(*) FROM events")
        total_count = cur.fetchone()[0]
        
        # Get event types breakdown
        cur.execute("SELECT event_type, COUNT(*) FROM events GROUP BY event_type")
        event_types = dict(cur.fetchall())
        
        # Get sample events
        cur.execute("SELECT session_id, event_type, element_id, scroll_depth, reaction_type FROM events LIMIT 10")
        sample_events = []
        for row in cur.fetchall():
            sample_events.append({
                "session_id": row[0],
                "event_type": row[1],
                "element_id": row[2],
                "scroll_depth": row[3],
                "reaction_type": row[4],
            })
        
        # Get unique session_ids
        cur.execute("SELECT DISTINCT session_id FROM events LIMIT 20")
        session_ids = [row[0] for row in cur.fetchall()]
        
        # Get user breakdown
        cur.execute("SELECT session_id FROM events")
        all_sessions = [row[0] for row in cur.fetchall()]
        user_breakdown = {}
        for session_id in all_sessions:
            if session_id and "-" in session_id:
                user_id = session_id.split("-", 1)[0]
                user_breakdown[user_id] = user_breakdown.get(user_id, 0) + 1
        
        return jsonify({
            "total_events": total_count,
            "event_types": event_types,
            "sample_events": sample_events,
            "session_ids_sample": session_ids[:10],
            "user_breakdown": user_breakdown,
        })
    finally:
        conn.close()


from analytics import load_events, group_by_user, compute_user_stats


@app.route("/admin/summary", methods=["GET"])
def admin_summary():
    """Aggregate analytics for all users.
    
    Returns JSON with per-user stats including reactions, dwell times, topics, etc.
    """
    conn = get_connection()
    try:
        # Load all events
        events = load_events(conn)
        print(f"[DEBUG] Loaded {len(events)} events from database")
        
        if len(events) > 0:
            # Debug: print first event structure
            first_event = events[0]
            print(f"[DEBUG] First event keys: {first_event.keys() if hasattr(first_event, 'keys') else 'Not a Row object'}")
            # Use dict-style access for Row objects, not .get()
            print(f"[DEBUG] First event sample: session_id={first_event['session_id']}, event_type={first_event['event_type']}")
        
        # Group by user
        user_groups = group_by_user(events)
        print(f"[DEBUG] Grouped into {len(user_groups)} users: {list(user_groups.keys())}")
        
        # Compute stats for each user
        result_users = []
        for user_id, user_events in user_groups.items():
            try:
                print(f"[DEBUG] Computing stats for {user_id} with {len(user_events)} events")
                stats = compute_user_stats(user_events)
                if stats:
                    print(f"[DEBUG] Stats for {user_id}: sessions={stats.get('sessions')}, reactions={stats.get('total_reactions')}, topics={len(stats.get('topics', {}))}")
                    result_users.append(stats)
            except Exception as e:
                # Log error but continue processing other users
                print(f"[ERROR] Error computing stats for {user_id}: {e}")
                import traceback
                traceback.print_exc()
        
        # Sort by user_id for consistency
        result_users.sort(key=lambda u: u["user_id"])
        
        print(f"[DEBUG] Returning {len(result_users)} users")
        response = {
            "users": result_users,
            "generated_at": datetime.utcnow().isoformat() + "Z"
        }
        
        # Debug: print summary
        import json
        print(f"[DEBUG] Response preview: {json.dumps(response, indent=2, default=str)[:500]}")
        
        return jsonify(response)
    except Exception as e:
        # Return error response
        print(f"[ERROR] Exception in admin_summary: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "error": str(e),
            "users": [],
            "generated_at": datetime.utcnow().isoformat() + "Z"
        }), 500
    finally:
        conn.close()

if __name__ == "__main__":
    app.run(debug=True)