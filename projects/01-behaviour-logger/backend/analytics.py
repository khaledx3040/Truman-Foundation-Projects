"""
Analytics engine for Truman Behaviour Lab.

Provides functions to load events, group by user, and compute rich metrics.
"""
import sqlite3
from db import get_connection


def load_events(conn):
    """Load all events from the database.
    
    Returns a list of dict-like Row objects with:
    - session_id, event_type, element_id, scroll_depth, reaction_type, timestamp
    """
    # Ensure row_factory is set (get_connection already sets it, but be safe)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT session_id, event_type, element_id, scroll_depth, reaction_type, timestamp
            FROM events
            ORDER BY timestamp ASC
        """)
        return cur.fetchall()
    except sqlite3.OperationalError as e:
        # Table might not exist yet
        print(f"Database error loading events: {e}")
        return []


def extract_user_id(session_id):
    """Extract user_id from session_id.
    
    Session IDs are formatted as: "user1-{uuid}" or "user1-{timestamp}-{random}"
    Returns the prefix (user1, user2, etc.) or None if invalid.
    """
    if not session_id:
        return None
    if "-" in session_id:
        return session_id.split("-", 1)[0]
    return session_id


def group_by_user(events):
    """Group events by user_id (extracted from session_id prefix).
    
    Returns a dict: {user_id: [list of events]}
    """
    grouped = {}
    for event in events:
        try:
            session_id = event["session_id"]
            if not session_id:
                continue
            user_id = extract_user_id(session_id)
            if not user_id:
                continue
            if user_id not in grouped:
                grouped[user_id] = []
            grouped[user_id].append(event)
        except (KeyError, TypeError) as e:
            print(f"[WARN] Error grouping event: {e}, event: {event}")
            continue
    return grouped


# Mapping from post ID to topic tag (as shown in the HTML)
# Reduced to 15 posts covering all topics
POST_TO_TOPIC = {
    "post1": "Religion",        # Mosque construction
    "post2": "Religion",        # Church leader on atheism
    "post3": "Left vs Right",   # 90% tax proposal
    "post4": "Left vs Right",   # Right-wing rally
    "post5": "Capitalism",      # Billionaire buys town
    "post6": "Communism",       # Communist party revival
    "post7": "Capitalism",      # Digital sweatshops
    "post8": "Surveillance",    # AI cameras tracking behavior
    "post9": "Surveillance",    # Social credit system
    "post10": "Immigration",    # Halve immigration plan
    "post11": "Immigration",    # Migrants sleeping outside
    "post12": "AI",             # AI cashiers replace workers
    "post13": "AI",             # AI predicts crime
    "post14": "Society",        # Relationships failing
    "post15": "Society",        # Avoid having children
}


def topic_from_element(element_id):
    """Extract topic from element_id.
    
    Element IDs are formatted as: "post1", "post2", etc.
    Returns the topic name from the POST_TO_TOPIC mapping or None.
    """
    if not element_id:
        return None
    # Handle both "post1" and "post1-Religion" formats (for backwards compatibility)
    post_id = element_id.split("-")[0] if "-" in element_id else element_id
    return POST_TO_TOPIC.get(post_id)


# Reaction polarity weights for ideology scoring
# Positive values push toward right/conservative/traditional
# Negative values push toward left/progressive/liberal
REACTION_WEIGHTS = {
    "like": 0.3,      # Mild agreement
    "love": 0.6,      # Strong agreement
    "sad": -0.4,      # Emotional disagreement
    "angry": -0.7,    # Strong disagreement
    "funny": -0.2,    # Ambiguous (weak disagreement/dismissal)
}

# Topic to ideology axis mapping
# Maps topic names to ideological axes and their polarity
# Format: {topic: (axis_name, left_label, right_label, polarity_multiplier)}
# polarity_multiplier: +1 if topic represents right/conservative, -1 if left/progressive
TOPIC_TO_AXIS = {
    "Left vs Right": ("left_right", "Left Wing", "Right Wing", 1),
    "Religion": ("religion", "Atheism", "Religion", 1),
    "Capitalism": ("capitalism", "Communism", "Capitalism", 1),
    "Communism": ("capitalism", "Communism", "Capitalism", -1),  # Inverted
    "Immigration": ("immigration", "Open Immigration", "Strict Immigration", 1),
    "AI": ("ai", "Anti-AI", "Pro-AI", 1),
    "Surveillance": ("surveillance", "Anti-Surveillance", "Pro-Surveillance", 1),
    "Society": ("culture", "Progressive Culture", "Traditional Culture", -1),  # Inverted
}


def compute_ideology_spectrum(events_for_user):
    """Compute ideology spectrum scores for a user based on reactions and behavior.
    
    Args:
        events_for_user: List of event Row objects for one user
        
    Returns:
        Dict with ideology scores (0-100) for each axis:
        {
            "left_right": 45,  # 0=left, 100=right
            "religion": 67,     # 0=atheist, 100=religious
            "capitalism": 82,   # 0=communist, 100=capitalist
            "immigration": 35,  # 0=open, 100=strict
            "ai": 55,           # 0=anti-AI, 100=pro-AI
            "surveillance": 40, # 0=anti-surveillance, 100=pro-surveillance
            "culture": 60,      # 0=progressive, 100=traditional
        }
    """
    # Initialize axis scores (raw weighted sums)
    axis_scores = {
        "left_right": [],
        "religion": [],
        "capitalism": [],
        "immigration": [],
        "ai": [],
        "surveillance": [],
        "culture": [],
    }
    
    # Track reactions per topic with latency
    topic_reactions = {}  # topic -> [(reaction_type, latency_ms)]
    
    # Track dwell times per topic (for engagement weighting)
    topic_dwell = {}  # topic -> [dwell_times]
    
    # Process all events to collect reactions and dwell times
    for event in events_for_user:
        try:
            event_type = event["event_type"]
            element_id = event["element_id"]
            topic = topic_from_element(element_id)
            
            if not topic:
                continue
            
            if event_type == "reaction":
                reaction_type = event["reaction_type"]
                latency_ms = event["scroll_depth"]  # Latency stored in scroll_depth
                
                if not reaction_type:
                    continue
                
                # Normalize reaction type
                rtype = reaction_type.lower()
                if rtype not in REACTION_WEIGHTS:
                    continue
                
                # Get latency (default to medium if not available)
                latency = latency_ms if latency_ms is not None else 5000
                
                # Store reaction for topic-based analysis
                if topic not in topic_reactions:
                    topic_reactions[topic] = []
                topic_reactions[topic].append((rtype, latency))
                
            elif event_type == "post_view_end":
                dwell_ms = event["scroll_depth"]  # Dwell stored in scroll_depth
                
                if dwell_ms is not None:
                    if topic not in topic_dwell:
                        topic_dwell[topic] = []
                    topic_dwell[topic].append(dwell_ms)
                    
        except (KeyError, TypeError):
            continue
    
    # Compute scores for each topic
    for topic, reactions in topic_reactions.items():
        if topic not in TOPIC_TO_AXIS:
            continue
        
        axis_name, left_label, right_label, polarity = TOPIC_TO_AXIS[topic]
        
        # Get average dwell for this topic (engagement weight)
        avg_dwell = 0
        if topic in topic_dwell and topic_dwell[topic]:
            avg_dwell = sum(topic_dwell[topic]) / len(topic_dwell[topic])
        
        # Process each reaction
        for rtype, latency in reactions:
            # Base reaction weight
            reaction_weight = REACTION_WEIGHTS[rtype]
            
            # Apply topic polarity
            weighted_score = reaction_weight * polarity
            
            # Latency modifier: fast reaction = stronger conviction
            # Normalize latency: < 2s = 1.5x, 2-8s = 1.0x, > 8s = 0.7x
            if latency < 2000:
                latency_multiplier = 1.5
            elif latency < 8000:
                latency_multiplier = 1.0
            else:
                latency_multiplier = 0.7
            
            # Dwell modifier: longer dwell = more engagement
            # Normalize: < 5s = 0.8x, 5-20s = 1.0x, > 20s = 1.2x
            dwell_multiplier = 1.0
            if avg_dwell > 0:
                if avg_dwell < 5000:
                    dwell_multiplier = 0.8
                elif avg_dwell < 20000:
                    dwell_multiplier = 1.0
                else:
                    dwell_multiplier = 1.2
            
            # Final weighted score
            final_score = weighted_score * latency_multiplier * dwell_multiplier
            axis_scores[axis_name].append(final_score)
    
    # Convert raw scores to 0-100 scale
    result = {}
    for axis_name in axis_scores:
        scores = axis_scores[axis_name]
        if not scores:
            # No data - default to neutral (50)
            result[axis_name] = 50
        else:
            # Sum all scores (can be negative or positive)
            total_score = sum(scores)
            
            # Normalize to 0-100 scale
            # Average score per reaction
            num_reactions = len(scores)
            avg_score = total_score / num_reactions
            
            # Convert to 0-100: -1.0 -> 0, 0 -> 50, +1.0 -> 100
            # Clamp the average to reasonable bounds (-1.5 to +1.5)
            clamped_avg = max(-1.5, min(1.5, avg_score))
            normalized = 50 + (clamped_avg * 33.33)  # Scale to fit 0-100
            
            # Clamp final result to 0-100
            result[axis_name] = max(0, min(100, normalized))
    
    return result


def compute_user_stats(events_for_user):
    """Compute comprehensive stats for a single user.
    
    Args:
        events_for_user: List of event Row objects for one user
        
    Returns:
        Dict with:
        - user_id
        - sessions (count of distinct session_ids)
        - avg_max_scroll (mean max scroll_depth from scroll + session_end)
        - avg_dwell_ms (average dwell from post_view_end events)
        - avg_latency_ms (average latency from reaction events)
        - total_reactions
        - reactions: {like, love, sad, angry, funny} counts
        - topics: {topic_name: {reactions, total_dwell_ms, avg_dwell_ms, weight}}
    """
    if not events_for_user:
        return None
    
    # Extract user_id from first event
    user_id = extract_user_id(events_for_user[0]["session_id"])
    
    # Initialize stats
    stats = {
        "user_id": user_id,
        "sessions": set(),
        "session_max_scrolls": [],  # max scroll per session
        "dwell_times": [],  # dwell times from post_view_end
        "latency_times": [],  # latency times from reactions
        "total_reactions": 0,
        "reactions": {
            "like": 0,
            "love": 0,
            "sad": 0,
            "angry": 0,
            "funny": 0,
        },
        "topics": {},  # topic -> {reactions, total_dwell_ms, dwell_count}
    }
    
    # Track max scroll per session
    session_max_scroll = {}  # session_id -> max scroll_depth
    
    # Process each event
    for event in events_for_user:
        # Access Row fields - Row objects support dict-style access with []
        # NULL columns return None when accessed
        try:
            event_type = event["event_type"]
            session_id = event["session_id"]
            # Row objects return None for NULL columns, so direct access is safe
            element_id = event["element_id"]  # Returns None if NULL
            scroll_depth = event["scroll_depth"]  # Returns None if NULL
            reaction_type = event["reaction_type"]  # Returns None if NULL
        except (KeyError, TypeError) as e:
            print(f"[WARN] Error accessing event fields: {e}, event: {event}")
            continue
        
        stats["sessions"].add(session_id)
        
        if event_type == "session_end":
            # Final scroll depth for this session
            if scroll_depth is not None:
                if session_id not in session_max_scroll:
                    session_max_scroll[session_id] = scroll_depth
                else:
                    session_max_scroll[session_id] = max(
                        session_max_scroll[session_id], scroll_depth
                    )
        
        elif event_type == "scroll":
            # Track max scroll per session
            if scroll_depth is not None:
                if session_id not in session_max_scroll:
                    session_max_scroll[session_id] = scroll_depth
                else:
                    session_max_scroll[session_id] = max(
                        session_max_scroll[session_id], scroll_depth
                    )
        
        elif event_type == "post_view_end":
            # Dwell time is stored in scroll_depth for this event type
            if scroll_depth is not None:
                dwell_ms = max(0, scroll_depth)
                stats["dwell_times"].append(dwell_ms)
                
                # Track by topic
                topic = topic_from_element(element_id)
                if topic:
                    if topic not in stats["topics"]:
                        stats["topics"][topic] = {
                            "reactions": 0,
                            "total_dwell_ms": 0,
                            "dwell_count": 0,
                        }
                    stats["topics"][topic]["total_dwell_ms"] += dwell_ms
                    stats["topics"][topic]["dwell_count"] += 1
        
        elif event_type == "reaction":
            # Latency is stored in scroll_depth for this event type
            stats["total_reactions"] += 1
            
            if scroll_depth is not None:
                latency_ms = max(0, scroll_depth)
                stats["latency_times"].append(latency_ms)
            
            # Track reaction type
            if reaction_type:
                # Normalize reaction type (lowercase)
                rtype = reaction_type.lower()
                if rtype in stats["reactions"]:
                    stats["reactions"][rtype] += 1
            
            # Track by topic
            topic = topic_from_element(element_id)
            if topic:
                if topic not in stats["topics"]:
                    stats["topics"][topic] = {
                        "reactions": 0,
                        "total_dwell_ms": 0,
                        "dwell_count": 0,
                    }
                stats["topics"][topic]["reactions"] += 1
    
    # Finalize stats
    result = {
        "user_id": user_id,
        "sessions": len(stats["sessions"]),
        "avg_max_scroll": None,
        "avg_dwell_ms": None,
        "avg_latency_ms": None,
        "total_reactions": stats["total_reactions"],
        "reactions": stats["reactions"],
        "topics": {},
    }
    
    # Compute avg_max_scroll from session max scrolls
    if session_max_scroll:
        max_scrolls = list(session_max_scroll.values())
        result["avg_max_scroll"] = sum(max_scrolls) / len(max_scrolls)
    
    # Compute avg_dwell_ms
    if stats["dwell_times"]:
        result["avg_dwell_ms"] = sum(stats["dwell_times"]) / len(stats["dwell_times"])
    
    # Compute avg_latency_ms
    if stats["latency_times"]:
        result["avg_latency_ms"] = sum(stats["latency_times"]) / len(stats["latency_times"])
    
    # Finalize topics with computed metrics
    for topic, tdata in stats["topics"].items():
        avg_dwell = (
            tdata["total_dwell_ms"] / tdata["dwell_count"]
            if tdata["dwell_count"] > 0
            else 0
        )
        # Weight = reactions * 2 + (total_dwell_ms / 5000)
        weight = (tdata["reactions"] * 2) + (tdata["total_dwell_ms"] / 5000.0)
        
        result["topics"][topic] = {
            "reactions": tdata["reactions"],
            "total_dwell_ms": tdata["total_dwell_ms"],
            "avg_dwell_ms": avg_dwell,
            "weight": weight,
        }
    
    # Compute ideology spectrum
    result["ideology_spectrum"] = compute_ideology_spectrum(events_for_user)
    
    # Compute psychological profile
    result["psychological_profile"] = compute_psychological_profile(
        result, stats, events_for_user
    )
    
    return result


def compute_psychological_profile(user_stats, raw_stats, events_for_user):
    """Compute psychological profile dimensions for a user.
    
    Args:
        user_stats: Finalized user stats dict (with avg_max_scroll, avg_dwell_ms, etc.)
        raw_stats: Raw stats dict with lists (dwell_times, latency_times, etc.)
        events_for_user: List of event Row objects for one user
        
    Returns:
        Dict with psychological profile scores:
        {
            "engagement_level": 0-100,
            "emotional_intensity": 0-100,
            "decision_speed": "impulsive" | "balanced" | "deliberate",
            "decision_speed_score": 0-100,  # 0=impulsive, 100=deliberate
            "controversy_seeking": 0-100,
        }
    """
    profile = {}
    
    # A. Engagement Level (0-100)
    # Based on: scroll %, dwell time, number of sessions
    engagement_score = 0
    components = []
    
    # Scroll component (0-40 points)
    if user_stats["avg_max_scroll"] is not None:
        scroll_pct = min(100, max(0, user_stats["avg_max_scroll"]))
        scroll_component = (scroll_pct / 100.0) * 40
        components.append(scroll_component)
    
    # Dwell component (0-35 points)
    if user_stats["avg_dwell_ms"] is not None:
        # Normalize: 0ms = 0, 5000ms = 17.5, 20000ms+ = 35
        dwell_ms = user_stats["avg_dwell_ms"]
        dwell_component = min(35, (dwell_ms / 20000.0) * 35)
        components.append(dwell_component)
    
    # Sessions component (0-25 points)
    # More sessions = higher engagement
    sessions = user_stats["sessions"]
    if sessions > 0:
        # Normalize: 1 session = 5, 5+ sessions = 25
        sessions_component = min(25, 5 + (sessions - 1) * 5)
        components.append(sessions_component)
    
    if components:
        engagement_score = sum(components)
    else:
        engagement_score = 0
    
    profile["engagement_level"] = min(100, max(0, engagement_score))
    
    # B. Emotional Intensity (0-100)
    # Percentage of strong emotional reactions (love, sad, angry) vs total
    total_reactions = user_stats["total_reactions"]
    if total_reactions > 0:
        strong_reactions = (
            user_stats["reactions"].get("love", 0) +
            user_stats["reactions"].get("sad", 0) +
            user_stats["reactions"].get("angry", 0)
        )
        emotional_intensity = (strong_reactions / total_reactions) * 100
    else:
        emotional_intensity = 0
    
    profile["emotional_intensity"] = min(100, max(0, emotional_intensity))
    
    # C. Decision Speed (Impulsive ↔ Deliberate)
    # Based on average reaction latency
    if user_stats["avg_latency_ms"] is not None:
        avg_latency_ms = user_stats["avg_latency_ms"]
        avg_latency_s = avg_latency_ms / 1000.0
        
        # Map latency to spectrum: < 2s = impulsive, 2-8s = balanced, > 8s = deliberate
        if avg_latency_s < 2.0:
            decision_speed = "impulsive"
            decision_speed_score = 0 + ((avg_latency_s / 2.0) * 33)  # 0-33
        elif avg_latency_s < 8.0:
            decision_speed = "balanced"
            decision_speed_score = 33 + (((avg_latency_s - 2.0) / 6.0) * 34)  # 33-67
        else:
            decision_speed = "deliberate"
            decision_speed_score = 67 + min(33, ((avg_latency_s - 8.0) / 10.0) * 33)  # 67-100
        
        profile["decision_speed"] = decision_speed
        profile["decision_speed_score"] = min(100, max(0, decision_speed_score))
        profile["avg_latency_seconds"] = round(avg_latency_s, 1)
    else:
        profile["decision_speed"] = "balanced"
        profile["decision_speed_score"] = 50
        profile["avg_latency_seconds"] = None
    
    # D. Controversy Seeking (0-100)
    # Ratio of engagement (reactions + dwell) on sensitive topics vs all topics
    sensitive_topics = {
        "Left vs Right",
        "Religion",
        "Capitalism",
        "Communism",
        "Immigration",
        "Surveillance",
        "AI",
    }
    
    total_sensitive_reactions = 0
    total_sensitive_dwell = 0
    total_all_reactions = user_stats["total_reactions"]
    total_all_dwell = sum(
        t["total_dwell_ms"] for t in user_stats["topics"].values()
    )
    
    for topic, tdata in user_stats["topics"].items():
        if topic in sensitive_topics:
            total_sensitive_reactions += tdata["reactions"]
            total_sensitive_dwell += tdata["total_dwell_ms"]
    
    # Compute ratio: (sensitive reactions + dwell) / (all reactions + dwell)
    # Weight reactions more heavily (2x)
    if total_all_reactions > 0 or total_all_dwell > 0:
        sensitive_engagement = (total_sensitive_reactions * 2) + (total_sensitive_dwell / 1000.0)
        all_engagement = (total_all_reactions * 2) + (total_all_dwell / 1000.0)
        
        if all_engagement > 0:
            controversy_ratio = sensitive_engagement / all_engagement
            controversy_seeking = controversy_ratio * 100
        else:
            controversy_seeking = 0
    else:
        controversy_seeking = 0
    
    profile["controversy_seeking"] = min(100, max(0, controversy_seeking))
    
    return profile

