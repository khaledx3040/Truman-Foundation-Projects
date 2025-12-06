import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "events.db"


def get_conn():
    return sqlite3.connect(DB_PATH)


def main():
    conn = get_conn()
    cur = conn.cursor()

    print(f"Using DB at: {DB_PATH}\n")

    # Total events
    cur.execute("SELECT COUNT(*) FROM events")
    total_events = cur.fetchone()[0]
    print(f"📊 Total events: {total_events}")

    # Number of sessions
    cur.execute("SELECT COUNT(DISTINCT session_id) FROM events")
    sessions = cur.fetchone()[0]
    print(f"👤 Distinct sessions: {sessions}")

    # Events by type
    print("\n🔍 Events by type:")
    cur.execute("SELECT event_type, COUNT(*) FROM events GROUP BY event_type")
    for event_type, count in cur.fetchall():
        print(f"  - {event_type}: {count}")

    # Most clicked elements
    print("\n🖱️ Most clicked elements:")
    cur.execute(
        """
        SELECT element_id, COUNT(*) as c
        FROM events
        WHERE event_type = 'click'
        GROUP BY element_id
        ORDER BY c DESC
        LIMIT 5
        """
    )
    rows = cur.fetchall()
    if rows:
        for element_id, count in rows:
            print(f"  - {element_id}: {count} clicks")
    else:
        print("  (no click events)")

    # Max scroll per session
    print("\n📜 Max scroll depth per session (first 10):")
    cur.execute(
        """
        SELECT session_id, MAX(scroll_depth)
        FROM events
        WHERE event_type = 'scroll'
        GROUP BY session_id
        ORDER BY MAX(scroll_depth) DESC
        LIMIT 10
        """
    )
    scroll_rows = cur.fetchall()
    if scroll_rows:
        for session_id, max_scroll in scroll_rows:
            print(f"  - {session_id[:8]}... : {max_scroll}%")
    else:
        print("  (no scroll events)")

    # Average max scroll across sessions
    cur.execute(
        """
        SELECT AVG(max_scroll)
        FROM (
            SELECT MAX(scroll_depth) AS max_scroll
            FROM events
            WHERE event_type = 'scroll'
            GROUP BY session_id
        )
        """
    )
    row = cur.fetchone()
    if row and row[0] is not None:
        print(f"\n📈 Average max scroll depth: {row[0]:.2f}%")
    else:
        print("\n📈 Average max scroll depth: (no data)")

    conn.close()


if __name__ == "__main__":
    main()
