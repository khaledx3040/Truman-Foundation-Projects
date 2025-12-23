const API_BASE = "http://127.0.0.1:5000";

// We only care about these users
const ALLOWED_USERS = ["user1", "user2", "user3", "user4", "user5"];

async function fetchSummary() {
  try {
    const res = await fetch(`${API_BASE}/admin/summary`);
    if (!res.ok) {
      const errorText = await res.text();
      console.error("Backend error:", res.status, errorText);
      throw new Error(`Failed to load summary: ${res.status} ${errorText}`);
    }
    const data = await res.json();
    console.log("Fetched summary data:", data);
    return data;
  } catch (err) {
    console.error("Fetch error:", err);
    throw err;
  }
}

function formatMsToSeconds(ms) {
  if (ms == null) return "–";
  return (ms / 1000).toFixed(1) + "s";
}

function formatPercent(value) {
  if (value == null) return "–";
  return value.toFixed(0) + "%";
}

function emptyReactionCounts() {
  return { like: 0, love: 0, sad: 0, angry: 0, funny: 0 };
}

// Map: user_id -> stats (only user1..user5)
function buildUserMap(rawUsers) {
  const map = {};
  rawUsers.forEach((u) => {
    if (!ALLOWED_USERS.includes(u.user_id)) return;
    map[u.user_id] = u;
  });
  return map;
}

// Aggregate "all users"
function buildAggregateUser(userMap) {
  const users = Object.values(userMap);
  if (!users.length) return null;

  const agg = {
    user_id: "all",
    sessions: 0,
    avg_max_scroll: null,
    avg_dwell_ms: null,
    avg_latency_ms: null,
    total_reactions: 0,
    reactions: emptyReactionCounts(),
    topics: {},
    ideology_spectrum: {},
    psychological_profile: null,
  };

  let scrollSum = 0,
    scrollCount = 0;
  let dwellSum = 0,
    dwellCount = 0;
  let latencySum = 0,
    latencyCount = 0;

  users.forEach((u) => {
    agg.sessions += u.sessions || 0;
    agg.total_reactions += u.total_reactions || 0;

    if (u.reactions) {
      for (const [k, v] of Object.entries(u.reactions)) {
        if (agg.reactions[k] != null) {
          agg.reactions[k] += v || 0;
        }
      }
    }

    if (u.avg_max_scroll != null) {
      scrollSum += u.avg_max_scroll;
      scrollCount += 1;
    }
    if (u.avg_dwell_ms != null) {
      dwellSum += u.avg_dwell_ms;
      dwellCount += 1;
    }
    if (u.avg_latency_ms != null) {
      latencySum += u.avg_latency_ms;
      latencyCount += 1;
    }

    if (u.topics) {
      for (const [topic, t] of Object.entries(u.topics)) {
        const tgt =
          agg.topics[topic] || {
            reactions: 0,
            total_dwell_ms: 0,
            avg_dwell_ms: 0,
            weight: 0,
          };
        tgt.reactions += t.reactions || 0;
        tgt.total_dwell_ms += t.total_dwell_ms || 0;
        agg.topics[topic] = tgt;
      }
    }

    // Aggregate ideology spectrum (average scores)
    // Handle both old format (number) and new format (object with score)
    if (u.ideology_spectrum) {
      for (const [axis, scoreData] of Object.entries(u.ideology_spectrum)) {
        if (agg.ideology_spectrum[axis] === undefined) {
          agg.ideology_spectrum[axis] = { sum: 0, count: 0 };
        }
        // Extract score from old or new format
        const score = typeof scoreData === "number" ? scoreData : (scoreData.score || 50);
        agg.ideology_spectrum[axis].sum += score;
        agg.ideology_spectrum[axis].count += 1;
      }
    }
  });

  if (scrollCount > 0) agg.avg_max_scroll = scrollSum / scrollCount;
  if (dwellCount > 0) agg.avg_dwell_ms = dwellSum / dwellCount;
  if (latencyCount > 0) agg.avg_latency_ms = latencySum / latencyCount;

  // Finalize ideology spectrum averages
  for (const [axis, data] of Object.entries(agg.ideology_spectrum)) {
    if (data.count > 0) {
      agg.ideology_spectrum[axis] = data.sum / data.count;
    } else {
      agg.ideology_spectrum[axis] = 50; // Neutral default
    }
  }

  // Aggregate psychological profiles (average scores)
  // Handle both old format (numbers) and new format (objects with score/confidence)
  function extractScore(metric) {
    if (typeof metric === "number") return metric;
    if (typeof metric === "object" && metric.score !== undefined) return metric.score;
    return 0;
  }

  const profileSums = {
    engagement_level: 0,
    emotional_intensity: 0,
    decision_speed_score: 0,
    controversy_seeking: 0,
  };
  let profileCount = 0;

  users.forEach((u) => {
    if (u.psychological_profile) {
      const p = u.psychological_profile;
      profileSums.engagement_level += extractScore(p.engagement_level);
      profileSums.emotional_intensity += extractScore(p.emotional_intensity);
      
      // Handle decision_speed which might be object or separate score field
      const ds = p.decision_speed;
      if (typeof ds === "object" && ds.score !== undefined) {
        profileSums.decision_speed_score += ds.score;
      } else {
        profileSums.decision_speed_score += extractScore(p.decision_speed_score) || 50;
      }
      
      profileSums.controversy_seeking += extractScore(p.controversy_seeking);
      profileCount += 1;
    }
  });

  if (profileCount > 0) {
    agg.psychological_profile = {
      engagement_level: profileSums.engagement_level / profileCount,
      emotional_intensity: profileSums.emotional_intensity / profileCount,
      decision_speed: "balanced",
      decision_speed_score: profileSums.decision_speed_score / profileCount,
      controversy_seeking: profileSums.controversy_seeking / profileCount,
      avg_latency_seconds: agg.avg_latency_ms ? agg.avg_latency_ms / 1000 : null,
    };
  }

  for (const [topic, t] of Object.entries(agg.topics)) {
    t.avg_dwell_ms = t.total_dwell_ms / Math.max(1, users.length);
  }

  return agg;
}

/* ---------- Rendering ---------- */

function renderMetrics(user, userCount) {
  const isAll = user.user_id === "all";
  document.getElementById("m-users").textContent = isAll ? userCount : 1;
  document.getElementById("m-sessions").textContent = user.sessions || 0;
  document.getElementById("m-scroll").textContent = formatPercent(
    user.avg_max_scroll
  );
  document.getElementById("m-dwell").textContent = formatMsToSeconds(
    user.avg_dwell_ms
  );
  document.getElementById("m-latency").textContent = formatMsToSeconds(
    user.avg_latency_ms
  );
  document.getElementById("m-total-reactions").textContent =
    user.total_reactions || 0;

  const detailTitle = document.getElementById("detail-title");
  const detailSubtitle = document.getElementById("detail-subtitle");
  if (isAll) {
    detailTitle.textContent = "Overview: all users";
    detailSubtitle.textContent =
      "Behaviour fingerprint combining all tracked users.";
  } else {
    detailTitle.textContent = `Profile: ${user.user_id}`;
    detailSubtitle.textContent = `Behaviour fingerprint built from ${
      user.sessions
    } session${user.sessions === 1 ? "" : "s"}.`;
  }
}

function renderEmotionalProfile(user) {
  const container = document.getElementById("reaction-bars");
  container.innerHTML = "";
  const reactions = user.reactions || emptyReactionCounts();
  const total = Object.values(reactions).reduce((a, b) => a + (b || 0), 0);

  const reactionOrder = ["like", "love", "sad", "angry", "funny"];
  const emojiMap = {
    like: "👍",
    love: "❤️",
    sad: "😢",
    angry: "😡",
    funny: "😂",
  };

  if (!total) {
    container.textContent = "No reactions yet.";
    return;
  }

  reactionOrder.forEach((type) => {
    const count = reactions[type] || 0;
    if (!count) return;
    const pct = (count / total) * 100;

    const row = document.createElement("div");
    row.className = "emotion-row";

    const label = document.createElement("div");
    label.className = "emotion-label";
    label.innerHTML = `<span>${emojiMap[type]}</span><span>${type}</span>`;

    const outer = document.createElement("div");
    outer.className = "emotion-bar-outer";

    const inner = document.createElement("div");
    inner.className = "emotion-bar-inner";
    inner.style.width = pct.toFixed(1) + "%";

    outer.appendChild(inner);

    const pctEl = document.createElement("div");
    pctEl.className = "emotion-percent";
    pctEl.textContent = pct.toFixed(0) + "%";

    row.append(label, outer, pctEl);
    container.appendChild(row);
  });
}

function renderDecisionSpeed(user, userMap, isAllUsers) {
  const main = document.getElementById("decision-speed-main");
  const meta = document.getElementById("decision-speed-meta");

  if (isAllUsers && userMap) {
    // Overview mode: show cohort statistics
    const users = Object.values(userMap).filter(u => u.avg_latency_ms != null);
    
    if (users.length === 0) {
      main.textContent = "No reaction-timing data yet for the group.";
      meta.textContent = "";
      return;
    }

    const latencyValues = users.map(u => u.avg_latency_ms / 1000);
    const avgLatency = latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length;
    const minLatency = Math.min(...latencyValues);
    const maxLatency = Math.max(...latencyValues);
    const minUser = users.find(u => (u.avg_latency_ms / 1000) === minLatency);
    const maxUser = users.find(u => (u.avg_latency_ms / 1000) === maxLatency);

    let label;
    if (avgLatency < 2) {
      label = "Group average: Impulsive";
    } else if (avgLatency < 8) {
      label = "Group average: Considered";
    } else {
      label = "Group average: Hesitant / reflective";
    }

    let rangeText = `Range: ${minLatency.toFixed(1)}s–${maxLatency.toFixed(1)}s`;
    if (minUser && maxUser && minUser !== maxUser) {
      rangeText += ` (fastest: ${minUser.user_id.replace("user", "u")}, slowest: ${maxUser.user_id.replace("user", "u")})`;
    }

    main.textContent = `${label} (${avgLatency.toFixed(1)}s avg). ${rangeText}.`;

    meta.textContent =
      "Group average based on the time between first seeing a post in focus and pressing a reaction button.";
  } else {
    // Single-user mode: keep original behavior
    if (!user.avg_latency_ms) {
      main.textContent = "No reaction-timing data yet.";
      meta.textContent = "";
      return;
    }

    const seconds = user.avg_latency_ms / 1000;
    let label;
    if (seconds < 2) {
      label = "Impulsive";
    } else if (seconds < 8) {
      label = "Considered";
    } else {
      label = "Hesitant / reflective";
    }

    main.textContent = `${label} (${seconds.toFixed(1)}s average reaction time)`;

    meta.textContent =
      "Based on the time between first seeing a post in focus and pressing a reaction button.";
  }
}

function renderTopics(user, topicFilterValue) {
  const list = document.getElementById("topic-list");
  list.innerHTML = "";

  if (!user.topics || Object.keys(user.topics).length === 0) {
    const li = document.createElement("li");
    li.className = "topic-row";
    li.textContent = "No topic data yet.";
    list.appendChild(li);
    return;
  }

  const entries = Object.entries(user.topics)
    .filter(([topic]) => {
      if (!topicFilterValue || topicFilterValue === "all") return true;
      return topic === topicFilterValue;
    })
    .sort((a, b) => (b[1].weight || 0) - (a[1].weight || 0))
    .slice(0, 5);

  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "topic-row";
    li.textContent = "No topics in this filter.";
    list.appendChild(li);
    return;
  }

  entries.forEach(([topic, info]) => {
    const li = document.createElement("li");
    li.className = "topic-row";
    li.innerHTML = `
      <span class="topic-label">${topic}</span>
      <span class="topic-metric">
        ${info.reactions || 0} reactions · ${formatMsToSeconds(
      info.avg_dwell_ms
    )} dwell
      </span>
    `;
    list.appendChild(li);
  });
}

function renderInsights(user, userMap, isAllUsers) {
  const ul = document.getElementById("insights-list");
  ul.innerHTML = "";

  const insights = [];

  if (isAllUsers && userMap) {
    // Overview mode: generate cohort-level insights
    const users = Object.values(userMap);
    const usersWithScroll = users.filter(u => u.avg_max_scroll != null);
    const usersWithDwell = users.filter(u => u.avg_dwell_ms != null);
    const usersWithLatency = users.filter(u => u.avg_latency_ms != null);

    // Scroll insights
    if (usersWithScroll.length > 0) {
      const scrollValues = usersWithScroll.map(u => u.avg_max_scroll);
      const avgScroll = scrollValues.reduce((a, b) => a + b, 0) / scrollValues.length;
      const minScroll = Math.min(...scrollValues);
      const maxScroll = Math.max(...scrollValues);
      const minUser = usersWithScroll.find(u => u.avg_max_scroll === minScroll);
      const maxUser = usersWithScroll.find(u => u.avg_max_scroll === maxScroll);
      
      if (avgScroll < 30) {
        insights.push(`Group trend: On average, users scroll shallowly (avg ${avgScroll.toFixed(0)}%). ${maxUser ? `Deepest scroller: ${maxUser.user_id.replace("user", "u")} (${maxScroll.toFixed(0)}%).` : ""}`);
      } else if (avgScroll > 75) {
        insights.push(`Group trend: On average, users scroll deeply (avg ${avgScroll.toFixed(0)}%). ${minUser ? `Shallowest scroller: ${minUser.user_id.replace("user", "u")} (${minScroll.toFixed(0)}%).` : ""}`);
      } else {
        insights.push(`Average scroll depth: ${avgScroll.toFixed(0)}% (range: ${minScroll.toFixed(0)}%–${maxScroll.toFixed(0)}%).`);
      }
    }

    // Dwell insights
    if (usersWithDwell.length > 0) {
      const dwellValues = usersWithDwell.map(u => u.avg_dwell_ms / 1000);
      const avgDwell = dwellValues.reduce((a, b) => a + b, 0) / dwellValues.length;
      const minDwell = Math.min(...dwellValues);
      const maxDwell = Math.max(...dwellValues);
      const minUser = usersWithDwell.find(u => (u.avg_dwell_ms / 1000) === minDwell);
      const maxUser = usersWithDwell.find(u => (u.avg_dwell_ms / 1000) === maxDwell);
      
      if (avgDwell > 40) {
        insights.push(`Group trend: High attention on average (avg ${avgDwell.toFixed(1)}s per post). ${minUser ? `Lowest attention: ${minUser.user_id.replace("user", "u")} (${minDwell.toFixed(1)}s).` : ""}`);
      } else if (avgDwell < 10) {
        insights.push(`Group trend: Low attention on average (avg ${avgDwell.toFixed(1)}s per post). ${maxUser ? `Highest attention: ${maxUser.user_id.replace("user", "u")} (${maxDwell.toFixed(1)}s).` : ""}`);
      } else {
        insights.push(`Average dwell time: ${avgDwell.toFixed(1)}s per post (range: ${minDwell.toFixed(1)}s–${maxDwell.toFixed(1)}s).`);
      }
    }

    // Latency insights
    if (usersWithLatency.length > 0) {
      const latencyValues = usersWithLatency.map(u => u.avg_latency_ms / 1000);
      const avgLatency = latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length;
      const minLatency = Math.min(...latencyValues);
      const maxLatency = Math.max(...latencyValues);
      const minUser = usersWithLatency.find(u => (u.avg_latency_ms / 1000) === minLatency);
      const maxUser = usersWithLatency.find(u => (u.avg_latency_ms / 1000) === maxLatency);
      
      if (avgLatency < 2) {
        insights.push(`Group trend: Fast decision-making on average (avg ${avgLatency.toFixed(1)}s). ${maxUser ? `Slowest: ${maxUser.user_id.replace("user", "u")} (${maxLatency.toFixed(1)}s).` : ""}`);
      } else if (avgLatency > 10) {
        insights.push(`Group trend: Slow decision-making on average (avg ${avgLatency.toFixed(1)}s). ${minUser ? `Fastest: ${minUser.user_id.replace("user", "u")} (${minLatency.toFixed(1)}s).` : ""}`);
      } else {
        insights.push(`Average reaction latency: ${avgLatency.toFixed(1)}s (range: ${minLatency.toFixed(1)}s–${maxLatency.toFixed(1)}s). ${minUser ? `Fastest: ${minUser.user_id.replace("user", "u")}; ` : ""}${maxUser ? `slowest: ${maxUser.user_id.replace("user", "u")}.` : ""}`);
      }
    }

    // Topic insights
    if (user.topics && Object.keys(user.topics).length > 0) {
      const sorted = Object.entries(user.topics).sort(
        (a, b) => (b[1].weight || 0) - (a[1].weight || 0)
      );
      const [topTopic] = sorted[0];
      insights.push(`Top topic by combined dwell+reactions: "${topTopic}".`);
      if (sorted[1]) {
        const [secondTopic] = sorted[1];
        insights.push(`Secondary topic: "${secondTopic}".`);
      }
    }

    if (!insights.length) {
      insights.push("Not enough aggregate data yet to generate cohort insights.");
    }
  } else {
    // Single-user mode: keep personal language
    if (user.avg_max_scroll != null) {
      if (user.avg_max_scroll > 75) {
        insights.push("Deep scroller: consistently explores most of the feed.");
      } else if (user.avg_max_scroll < 30) {
        insights.push(
          "Shallow scroller: rarely goes beyond the first part of the feed."
        );
      }
    }

    if (user.avg_dwell_ms != null) {
      const s = user.avg_dwell_ms / 1000;
      if (s > 40) {
        insights.push(
          "High attention: tends to spend a long time on each post in focus."
        );
      } else if (s < 10) {
        insights.push(
          "Low attention: glances over posts quickly before moving on."
        );
      }
    }

    if (user.avg_latency_ms != null) {
      const s = user.avg_latency_ms / 1000;
      if (s < 2) {
        insights.push(
          "Fast decision-maker: reacts almost immediately once a post is seen."
        );
      } else if (s > 10) {
        insights.push(
          "Slow decision-maker: needs significant time before reacting."
        );
      }
    }

    if (user.topics && Object.keys(user.topics).length > 0) {
      const sorted = Object.entries(user.topics).sort(
        (a, b) => (b[1].weight || 0) - (a[1].weight || 0)
      );
      const [topTopic] = sorted[0];
      insights.push(`Most sensitive to "${topTopic}" content.`);
      if (sorted[1]) {
        const [secondTopic] = sorted[1];
        insights.push(
          `Secondary interest in "${secondTopic}" – reacts and dwells there too.`
        );
      }
    }

    if (!insights.length) {
      insights.push("Not enough data yet to generate behavioural insights.");
    }
  }

  insights.forEach((txt) => {
    const li = document.createElement("li");
    li.textContent = txt;
    ul.appendChild(li);
  });
}

function renderIdeologySpectrum(user, userMap, isAllUsers, onUserClick) {
  const container = document.getElementById("ideology-spectrum");
  const subtitle = document.getElementById("ideology-spectrum-subtitle");
  container.innerHTML = "";

  // Update subtitle based on mode
  if (isAllUsers) {
    subtitle.textContent =
      "Ideological positioning for all users. Compare positions and identify clusters. Click a marker to view that user's profile.";
  } else {
    subtitle.textContent =
      "Ideological positioning based on reactions and engagement patterns.";
  }

  // Define all spectrum axes with labels
  const axes = [
    {
      key: "left_right",
      leftLabel: "Left Wing",
      rightLabel: "Right Wing",
    },
    {
      key: "religion",
      leftLabel: "Atheism",
      rightLabel: "Religion",
    },
    {
      key: "capitalism",
      leftLabel: "Communism",
      rightLabel: "Capitalism",
    },
    {
      key: "immigration",
      leftLabel: "Open Immigration",
      rightLabel: "Strict Immigration",
    },
    {
      key: "ai",
      leftLabel: "Anti-AI",
      rightLabel: "Pro-AI",
    },
    {
      key: "surveillance",
      leftLabel: "Anti-Surveillance",
      rightLabel: "Pro-Surveillance",
    },
    {
      key: "culture",
      leftLabel: "Progressive Culture",
      rightLabel: "Traditional Culture",
    },
  ];

  // User colors for markers
  const userColors = {
    user1: "#3b82f6", // Blue
    user2: "#10b981", // Green
    user3: "#f59e0b", // Amber
    user4: "#ef4444", // Red
    user5: "#8b5cf6", // Purple
  };

  if (isAllUsers && userMap) {
    // Multi-user mode: card-based layout
    // Add user legend
    const legend = document.createElement("div");
    legend.className = "spectrum-legend";
    const legendTitle = document.createElement("div");
    legendTitle.className = "spectrum-legend-title";
    legendTitle.textContent = "User Legend:";
    legend.appendChild(legendTitle);
    
    const legendItems = document.createElement("div");
    legendItems.className = "spectrum-legend-items";
    Object.entries(userColors).forEach(([userId, color]) => {
      const item = document.createElement("div");
      item.className = "spectrum-legend-item";
      const dot = document.createElement("span");
      dot.className = "spectrum-legend-dot";
      dot.style.backgroundColor = color;
      const label = document.createElement("span");
      label.className = "spectrum-legend-label";
      label.textContent = userId.replace("user", "u");
      item.appendChild(dot);
      item.appendChild(label);
      legendItems.appendChild(item);
    });
    legend.appendChild(legendItems);
    container.appendChild(legend);

    // Create card grid container
    const cardGrid = document.createElement("div");
    cardGrid.className = "spectrum-card-grid";

    axes.forEach((axis) => {
      // Collect scores for all users on this axis
      // Handle both old format (number) and new format (object)
      const userScores = [];
      Object.entries(userMap).forEach(([userId, userData]) => {
        if (
          userData.ideology_spectrum &&
          userData.ideology_spectrum[axis.key] !== undefined &&
          userData.ideology_spectrum[axis.key] !== null
        ) {
          const scoreData = userData.ideology_spectrum[axis.key];
          const score = typeof scoreData === "number" ? scoreData : (scoreData.score || 50);
          const confidence = typeof scoreData === "object" ? (scoreData.confidence || "medium") : "medium";
          const isNeutral = typeof scoreData === "object" ? (scoreData.is_neutral || false) : false;
          
          userScores.push({
            userId,
            score,
            confidence,
            isNeutral,
          });
        }
      });

      // Create card
      const card = document.createElement("div");
      card.className = "spectrum-card";

      // Card header
      const cardHeader = document.createElement("div");
      cardHeader.className = "spectrum-card-header";
      
      const headerCenter = document.createElement("div");
      headerCenter.className = "spectrum-card-header-title";
      // Convert key to readable title
      const titleMap = {
        left_right: "Political Leaning",
        religion: "Religious Orientation",
        capitalism: "Economic System",
        immigration: "Immigration Policy",
        ai: "AI Stance",
        surveillance: "Surveillance Views",
        culture: "Cultural Values",
      };
      headerCenter.textContent = titleMap[axis.key] || axis.key;
      
      const headerCount = document.createElement("div");
      headerCount.className = "spectrum-card-header-count";
      headerCount.textContent = `${userScores.length}/5 users`;

      cardHeader.appendChild(headerCenter);
      cardHeader.appendChild(headerCount);

      // Card body
      const cardBody = document.createElement("div");
      cardBody.className = "spectrum-card-body";

      if (userScores.length === 0) {
        // No data
        const emptyMsg = document.createElement("div");
        emptyMsg.className = "spectrum-card-empty";
        emptyMsg.textContent = "No ideology data for this topic yet.";
        cardBody.appendChild(emptyMsg);
        card.appendChild(cardHeader);
        card.appendChild(cardBody);
        cardGrid.appendChild(card);
        return;
      }

      // Sort by score
      userScores.sort((a, b) => a.score - b.score);

      // Spectrum bar
      const barContainer = document.createElement("div");
      barContainer.className = "spectrum-card-bar-container";

      const barTrack = document.createElement("div");
      barTrack.className = "spectrum-card-bar-track";

      // Gradient background
      const barGradient = document.createElement("div");
      barGradient.className = "spectrum-card-bar-gradient";
      barTrack.appendChild(barGradient);

      // Add direction labels on the bar
      const leftLabel = document.createElement("div");
      leftLabel.className = "spectrum-card-bar-label spectrum-card-bar-label-left";
      leftLabel.textContent = axis.leftLabel;
      barTrack.appendChild(leftLabel);

      const rightLabel = document.createElement("div");
      rightLabel.className = "spectrum-card-bar-label spectrum-card-bar-label-right";
      rightLabel.textContent = axis.rightLabel;
      barTrack.appendChild(rightLabel);

      // Add markers for each user
      userScores.forEach(({ userId, score, confidence, isNeutral }) => {
        const clampedScore = Math.max(0, Math.min(100, score));
        const marker = document.createElement("div");
        marker.className = "spectrum-card-marker spectrum-card-marker-clickable";
        marker.style.left = `${clampedScore}%`;
        marker.style.borderColor = userColors[userId] || "#64748b";
        
        // Adjust opacity for low confidence
        if (confidence === "low") {
          marker.style.opacity = "0.6";
        }
        
        // Add neutral indicator
        if (isNeutral) {
          marker.classList.add("spectrum-card-marker-neutral");
        }
        
        const positionLabel = clampedScore < 40 ? axis.leftLabel : clampedScore > 60 ? axis.rightLabel : "center";
        let tooltipText = `Click to view ${userId}'s profile – ${clampedScore.toFixed(0)}/100 (${positionLabel})`;
        if (confidence === "low") {
          tooltipText += " - low confidence";
        } else if (isNeutral) {
          tooltipText += " - neutral/mixed";
        }
        marker.title = tooltipText;

        // User label inside circle
        const label = document.createElement("div");
        label.className = "spectrum-card-marker-label";
        label.textContent = userId.replace("user", "");
        marker.appendChild(label);

        // Add click handler to navigate to user profile
        if (onUserClick) {
          marker.addEventListener("click", (e) => {
            e.stopPropagation();
            onUserClick(userId);
          });
        }

        barTrack.appendChild(marker);
      });

      barContainer.appendChild(barTrack);
      cardBody.appendChild(barContainer);

      // User list preview
      const leftUsers = userScores.filter((u) => u.score < 33).map((u) => u.userId.replace("user", "u"));
      const centerUsers = userScores.filter((u) => u.score >= 33 && u.score <= 67).map((u) => u.userId.replace("user", "u"));
      const rightUsers = userScores.filter((u) => u.score > 67).map((u) => u.userId.replace("user", "u"));

      const userPreview = document.createElement("div");
      userPreview.className = "spectrum-card-user-preview";
      
      const previewParts = [];
      if (leftUsers.length > 0) {
        previewParts.push(`Left: ${leftUsers.join(", ")}`);
      }
      if (centerUsers.length > 0) {
        previewParts.push(`Centre: ${centerUsers.join(", ")}`);
      }
      if (rightUsers.length > 0) {
        previewParts.push(`Right: ${rightUsers.join(", ")}`);
      }
      
      if (previewParts.length > 0) {
        userPreview.textContent = previewParts.join(" • ");
        cardBody.appendChild(userPreview);
      }

      card.appendChild(cardHeader);
      card.appendChild(cardBody);
      cardGrid.appendChild(card);
    });

    container.appendChild(cardGrid);
  } else {
    // Single-user mode: show one marker per axis (existing behavior)
    const spectrum = user.ideology_spectrum || {};

    if (!spectrum || Object.keys(spectrum).length === 0) {
      container.textContent =
        "No ideology data yet. React to posts to generate spectrum scores.";
      return;
    }

    axes.forEach((axis) => {
      const scoreData = spectrum[axis.key];
      if (scoreData === undefined || scoreData === null) {
        return; // Skip if no data for this axis
      }

      // Handle both old format (number) and new format (object)
      let score, confidence, sampleSize, isNeutral;
      if (typeof scoreData === "number") {
        score = scoreData;
        confidence = "medium";
        sampleSize = {};
        isNeutral = false;
      } else {
        score = scoreData.score || 50;
        confidence = scoreData.confidence || "medium";
        sampleSize = scoreData.sample_size || {};
        isNeutral = scoreData.is_neutral || false;
      }

      // Clamp score to 0-100
      const clampedScore = Math.max(0, Math.min(100, score));
      const percentage = clampedScore.toFixed(0);

      // Create spectrum row
      const row = document.createElement("div");
      row.className = "spectrum-row";
      if (confidence === "low") {
        row.classList.add("spectrum-row-low-confidence");
      }

      // Left label
      const leftLabelEl = document.createElement("div");
      leftLabelEl.className = "spectrum-label spectrum-label-left";
      leftLabelEl.textContent = axis.leftLabel;

      // Bar container
      const barContainer = document.createElement("div");
      barContainer.className = "spectrum-bar-container";

      // Bar track
      const barTrack = document.createElement("div");
      barTrack.className = "spectrum-bar-track";

      // Bar fill (left side - represents left/progressive position)
      const barFillLeft = document.createElement("div");
      barFillLeft.className = "spectrum-bar-fill spectrum-bar-fill-left";
      barFillLeft.style.width = `${100 - clampedScore}%`;
      if (confidence === "low") {
        barFillLeft.style.opacity = "0.5";
      }

      // Bar fill (right side - represents right/conservative position)
      const barFillRight = document.createElement("div");
      barFillRight.className = "spectrum-bar-fill spectrum-bar-fill-right";
      barFillRight.style.width = `${clampedScore}%`;
      if (confidence === "low") {
        barFillRight.style.opacity = "0.5";
      }

      // Marker at score position
      const marker = document.createElement("div");
      marker.className = "spectrum-marker";
      marker.style.left = `${clampedScore}%`;
      if (confidence === "low") {
        marker.style.opacity = "0.6";
      }
      if (isNeutral) {
        marker.classList.add("spectrum-marker-neutral");
      }

      barTrack.appendChild(barFillLeft);
      barTrack.appendChild(barFillRight);
      barTrack.appendChild(marker);
      barContainer.appendChild(barTrack);

      // Right label
      const rightLabelEl = document.createElement("div");
      rightLabelEl.className = "spectrum-label spectrum-label-right";
      rightLabelEl.textContent = axis.rightLabel;

      // Score display with confidence indicator
      const scoreEl = document.createElement("div");
      scoreEl.className = "spectrum-score";
      let scoreText = `${percentage}/100`;
      if (confidence === "low") {
        scoreText += " (low confidence)";
      } else if (isNeutral) {
        scoreText += " (neutral)";
      }
      scoreEl.textContent = scoreText;
      
      // Add tooltip with sample size if available
      if (sampleSize.reactions !== undefined) {
        scoreEl.title = `Based on ${sampleSize.reactions} reaction${sampleSize.reactions !== 1 ? "s" : ""}`;
      }

      row.appendChild(leftLabelEl);
      row.appendChild(barContainer);
      row.appendChild(rightLabelEl);
      row.appendChild(scoreEl);

      container.appendChild(row);
    });
  }

  if (container.children.length === 0) {
    container.textContent = "No ideology data available.";
  }
}

/* ---------- Init ---------- */

async function init() {
  try {
    const data = await fetchSummary();
    const userMap = buildUserMap(data.users || []);
    const userCount = Object.keys(userMap).length;
    const allUser = buildAggregateUser(userMap);

    const userSelect = document.getElementById("admin-user-select");
    const topicSelect = document.getElementById("topic-filter");

    function getSelectedUser() {
      const value = userSelect.value;
      if (value === "all") {
        if (allUser) return allUser;
        return {
          user_id: "all",
          sessions: 0,
          avg_max_scroll: null,
          avg_dwell_ms: null,
          avg_latency_ms: null,
          total_reactions: 0,
          reactions: emptyReactionCounts(),
          topics: {},
        };
      }
      const u = userMap[value];
      if (u) return u;
      return {
        user_id: value,
        sessions: 0,
        avg_max_scroll: null,
        avg_dwell_ms: null,
        avg_latency_ms: null,
        total_reactions: 0,
        reactions: emptyReactionCounts(),
        topics: {},
      };
    }

    function renderProfileDimension(
      container,
      title,
      leftLabel,
      rightLabel,
      score,
      explanation,
      confidence = "medium",
      sampleSize = {}
    ) {
      const dimension = document.createElement("div");
      dimension.className = "psychological-dimension";

      const header = document.createElement("div");
      header.className = "psychological-dimension-header";
      
      const titleText = document.createElement("span");
      titleText.textContent = title;
      header.appendChild(titleText);
      
      // Add confidence badge
      if (confidence) {
        const confidenceBadge = document.createElement("span");
        confidenceBadge.className = `confidence-badge confidence-${confidence}`;
        confidenceBadge.textContent = confidence.toUpperCase();
        header.appendChild(confidenceBadge);
      }
      
      dimension.appendChild(header);

      const barContainer = document.createElement("div");
      barContainer.className = "psychological-bar-container";

      const labels = document.createElement("div");
      labels.className = "psychological-bar-labels";
      const left = document.createElement("span");
      left.className = "psychological-label-left";
      left.textContent = leftLabel;
      const right = document.createElement("span");
      right.className = "psychological-label-right";
      right.textContent = rightLabel;
      labels.appendChild(left);
      labels.appendChild(right);
      barContainer.appendChild(labels);

      const barTrack = document.createElement("div");
      barTrack.className = "psychological-bar-track";

      const barFill = document.createElement("div");
      barFill.className = "psychological-bar-fill";
      // Adjust opacity based on confidence
      if (confidence === "low") {
        barFill.style.opacity = "0.5";
      } else if (confidence === "medium") {
        barFill.style.opacity = "0.75";
      }
      barFill.style.width = `${Math.max(0, Math.min(100, score))}%`;

      const marker = document.createElement("div");
      marker.className = "psychological-bar-marker";
      if (confidence === "low") {
        marker.style.opacity = "0.6";
      }
      marker.style.left = `${Math.max(0, Math.min(100, score))}%`;

      barTrack.appendChild(barFill);
      barTrack.appendChild(marker);
      barContainer.appendChild(barTrack);

      // Score display
      const scoreEl = document.createElement("div");
      scoreEl.className = "psychological-score";
      scoreEl.textContent = `${Math.round(score)}/100`;
      barContainer.appendChild(scoreEl);

      const explanationEl = document.createElement("div");
      explanationEl.className = "psychological-explanation";
      explanationEl.textContent = explanation;

      dimension.appendChild(barContainer);
      dimension.appendChild(explanationEl);
      container.appendChild(dimension);
    }

    function renderPsychologicalProfile(user, userMap, isAllUsers) {
      const container = document.getElementById("psychological-profile");
      container.innerHTML = "";

      if (isAllUsers && userMap) {
        // All users mode: show aggregated comparison
        // Add header to indicate group profile
        const header = document.createElement("div");
        header.className = "psychological-profile-header";
        header.style.cssText = "font-weight: 600; margin-bottom: 1rem; color: #1e293b;";
        
        // Format user list: if all users 1-5 present, show "1–5", otherwise list them
        const userIds = Object.keys(userMap).map(u => parseInt(u.replace("user", ""))).sort((a, b) => a - b);
        let userListText;
        if (userIds.length === 5 && userIds[0] === 1 && userIds[4] === 5) {
          userListText = "1–5";
        } else {
          userListText = userIds.join(", ");
        }
        header.textContent = `Group Psychological Profile (Users ${userListText})`;
        container.appendChild(header);

        const profiles = [];
        Object.values(userMap).forEach((u) => {
          if (u.psychological_profile) {
            profiles.push({
              userId: u.user_id,
              profile: u.psychological_profile,
            });
          }
        });

        if (profiles.length === 0) {
          container.appendChild(document.createTextNode("No psychological profile data yet for the group."));
          return;
        }

        // Helper to extract score from new or old format
        function getScore(metric) {
          if (typeof metric === "number") return metric;
          if (typeof metric === "object" && metric.score !== undefined) return metric.score;
          return 0;
        }

        // Helper to compute range and find min/max users
        function computeRangeAndExtremes(scores, profiles) {
          if (scores.length === 0) return { min: 0, max: 0, range: 0, minUser: null, maxUser: null };
          const min = Math.min(...scores);
          const max = Math.max(...scores);
          const range = max - min;
          const minIndex = scores.indexOf(min);
          const maxIndex = scores.indexOf(max);
          return {
            min,
            max,
            range,
            minUser: profiles[minIndex] ? profiles[minIndex].userId.replace("user", "u") : null,
            maxUser: profiles[maxIndex] ? profiles[maxIndex].userId.replace("user", "u") : null
          };
        }

        // Compute scores for all dimensions
        const engagementData = profiles.map(p => ({
          userId: p.userId,
          score: getScore(p.profile.engagement_level)
        }));
        const emotionalData = profiles.map(p => ({
          userId: p.userId,
          score: getScore(p.profile.emotional_intensity)
        }));
        const decisionData = profiles.map(p => {
          const ds = p.profile.decision_speed;
          const score = typeof ds === "object" && ds.score !== undefined ? ds.score : getScore(p.profile.decision_speed_score);
          return { userId: p.userId, score };
        });
        const controversyData = profiles.map(p => ({
          userId: p.userId,
          score: getScore(p.profile.controversy_seeking)
        }));

        const engagementScores = engagementData.map(d => d.score);
        const emotionalScores = emotionalData.map(d => d.score);
        const decisionScores = decisionData.map(d => d.score);
        const controversyScores = controversyData.map(d => d.score);

        const avgEngagement = engagementScores.reduce((a, b) => a + b, 0) / engagementScores.length;
        const avgEmotional = emotionalScores.reduce((a, b) => a + b, 0) / emotionalScores.length;
        const avgDecisionSpeed = decisionScores.reduce((a, b) => a + b, 0) / decisionScores.length;
        const avgControversy = controversyScores.reduce((a, b) => a + b, 0) / controversyScores.length;

        // Compute ranges and extremes
        const engagementRange = computeRangeAndExtremes(engagementScores, profiles);
        const emotionalRange = computeRangeAndExtremes(emotionalScores, profiles);
        const decisionRange = computeRangeAndExtremes(decisionScores, profiles);
        const controversyRange = computeRangeAndExtremes(controversyScores, profiles);

        // Render aggregated view with cohort language
        let engagementExplanation = `Group average: ${avgEngagement.toFixed(0)}/100 (range: ${engagementRange.min.toFixed(0)}–${engagementRange.max.toFixed(0)}).`;
        if (engagementRange.maxUser && engagementRange.minUser) {
          engagementExplanation += ` Highest: ${engagementRange.maxUser}; lowest: ${engagementRange.minUser}.`;
        }
        renderProfileDimension(
          container,
          "Engagement Level",
          "Low",
          "High",
          avgEngagement,
          engagementExplanation,
          "medium",
          { users: profiles.length }
        );

        let emotionalExplanation = `Group average: ${avgEmotional.toFixed(0)}/100 (range: ${emotionalRange.min.toFixed(0)}–${emotionalRange.max.toFixed(0)}).`;
        if (emotionalRange.maxUser && emotionalRange.minUser) {
          emotionalExplanation += ` Most emotional: ${emotionalRange.maxUser}; least: ${emotionalRange.minUser}.`;
        }
        renderProfileDimension(
          container,
          "Emotional Intensity",
          "Calm / Neutral",
          "Highly Emotional",
          avgEmotional,
          emotionalExplanation,
          "medium",
          { users: profiles.length }
        );

        let decisionExplanation = `Group average: ${avgDecisionSpeed.toFixed(0)}/100 (range: ${decisionRange.min.toFixed(0)}–${decisionRange.max.toFixed(0)}, balanced = 50).`;
        if (decisionRange.maxUser && decisionRange.minUser) {
          decisionExplanation += ` Most deliberate: ${decisionRange.maxUser}; most impulsive: ${decisionRange.minUser}.`;
        }
        renderProfileDimension(
          container,
          "Decision Speed",
          "Impulsive",
          "Deliberate",
          avgDecisionSpeed,
          decisionExplanation,
          "medium",
          { users: profiles.length }
        );

        let controversyExplanation = `Group average: ${avgControversy.toFixed(0)}/100 (range: ${controversyRange.min.toFixed(0)}–${controversyRange.max.toFixed(0)}).`;
        if (controversyRange.maxUser && controversyRange.minUser) {
          controversyExplanation += ` Most controversy-seeking: ${controversyRange.maxUser}; least: ${controversyRange.minUser}.`;
        }
        renderProfileDimension(
          container,
          "Controversy Seeking",
          "Avoids Conflict",
          "Seeks Controversy",
          avgControversy,
          controversyExplanation,
          "medium",
          { users: profiles.length }
        );
      } else {
        // Single user mode
        const profile = user.psychological_profile;
        if (!profile) {
          container.textContent =
            "No psychological profile data yet. React to posts to generate profile.";
          return;
        }

        // Helper to get confidence-aware language
        function getConfidenceLanguage(baseText, confidence, isExtreme) {
          if (confidence === "low") {
            if (isExtreme) {
              return `Early signal: ${baseText.toLowerCase()} (low confidence - not enough data yet)`;
            }
            return `Tentative: ${baseText.toLowerCase()} (based on limited data)`;
          } else if (confidence === "medium") {
            return `Seems to ${baseText.toLowerCase()}`;
          } else {
            return baseText; // High confidence - direct statement
          }
        }

        // Engagement Level
        const engagement = profile.engagement_level || {};
        const engagementScore = typeof engagement === "number" ? engagement : engagement.score || 0;
        const engagementConf = typeof engagement === "object" ? engagement.confidence : "medium";
        const engagementSample = typeof engagement === "object" ? engagement.sample_size : {};
        
        let engagementLabel = "";
        const isHighEngagement = engagementScore > 70;
        const isLowEngagement = engagementScore < 30;
        
        if (isLowEngagement) {
          engagementLabel = getConfidenceLanguage("Low engagement (skims the feed)", engagementConf, true);
        } else if (isHighEngagement) {
          engagementLabel = getConfidenceLanguage("High engagement (often absorbed in the feed)", engagementConf, true);
        } else {
          engagementLabel = getConfidenceLanguage("Moderate engagement", engagementConf, false);
        }
        
        // Add sample size info
        if (engagementSample.sessions) {
          engagementLabel += ` (${engagementSample.sessions} session${engagementSample.sessions !== 1 ? "s" : ""})`;
        }

        renderProfileDimension(
          container,
          "Engagement Level",
          "Low",
          "High",
          engagementScore,
          engagementLabel,
          engagementConf,
          engagementSample
        );

        // Emotional Intensity
        const emotional = profile.emotional_intensity || {};
        const emotionalScore = typeof emotional === "number" ? emotional : emotional.score || 0;
        const emotionalConf = typeof emotional === "object" ? emotional.confidence : "medium";
        const emotionalSample = typeof emotional === "object" ? emotional.sample_size : {};
        
        let emotionalLabel = "";
        const isHighEmotional = emotionalScore > 70;
        const isLowEmotional = emotionalScore < 30;
        
        if (isLowEmotional) {
          emotionalLabel = getConfidenceLanguage("Mostly neutral or light reactions", emotionalConf, false);
        } else if (isHighEmotional) {
          emotionalLabel = getConfidenceLanguage("Highly emotionally reactive", emotionalConf, true);
        } else {
          emotionalLabel = getConfidenceLanguage("Shows emotions regularly", emotionalConf, false);
        }
        
        if (emotionalSample.total_reactions) {
          emotionalLabel += ` (${emotionalSample.total_reactions} reaction${emotionalSample.total_reactions !== 1 ? "s" : ""})`;
        }

        renderProfileDimension(
          container,
          "Emotional Intensity",
          "Calm / Neutral",
          "Highly Emotional",
          emotionalScore,
          emotionalLabel,
          emotionalConf,
          emotionalSample
        );

        // Decision Speed
        const decision = profile.decision_speed || {};
        const decisionScore = typeof decision === "object" && decision.score !== undefined 
          ? decision.score 
          : (typeof decision === "number" ? decision : profile.decision_speed_score || 50);
        const decisionLabel_text = typeof decision === "object" ? decision.label : profile.decision_speed || "balanced";
        const decisionConf = typeof decision === "object" ? decision.confidence : "medium";
        const decisionSample = typeof decision === "object" ? decision.sample_size : {};
        const latency = typeof decision === "object" ? decision.avg_latency_seconds : profile.avg_latency_seconds;
        
        let decisionLabel = "";
        if (decisionLabel_text === "impulsive") {
          decisionLabel = getConfidenceLanguage(
            `Usually reacts quickly without much hesitation`,
            decisionConf,
            true
          );
        } else if (decisionLabel_text === "deliberate") {
          decisionLabel = getConfidenceLanguage(
            `Takes time before reacting to most posts`,
            decisionConf,
            true
          );
        } else {
          decisionLabel = getConfidenceLanguage(
            `Takes moderate time before reacting`,
            decisionConf,
            false
          );
        }
        
        if (latency !== null && latency !== undefined) {
          decisionLabel += ` (${latency}s average)`;
        }
        if (decisionSample.reactions) {
          decisionLabel += ` - ${decisionSample.reactions} reaction${decisionSample.reactions !== 1 ? "s" : ""}`;
        }

        renderProfileDimension(
          container,
          "Decision Speed",
          "Impulsive",
          "Deliberate",
          decisionScore,
          decisionLabel,
          decisionConf,
          decisionSample
        );

        // Controversy Seeking
        const controversy = profile.controversy_seeking || {};
        const controversyScore = typeof controversy === "number" ? controversy : controversy.score || 0;
        const controversyConf = typeof controversy === "object" ? controversy.confidence : "medium";
        const controversySample = typeof controversy === "object" ? controversy.sample_size : {};
        
        let controversyLabel = "";
        const isHighControversy = controversyScore > 70;
        const isLowControversy = controversyScore < 30;
        
        if (isLowControversy) {
          controversyLabel = getConfidenceLanguage("Avoids controversial topics", controversyConf, false);
        } else if (isHighControversy) {
          controversyLabel = getConfidenceLanguage("Strong attraction to divisive topics", controversyConf, true);
        } else {
          controversyLabel = getConfidenceLanguage("Engages with some sensitive content", controversyConf, false);
        }
        
        if (controversySample.sensitive_reactions !== undefined) {
          controversyLabel += ` (${controversySample.sensitive_reactions} sensitive-topic reaction${controversySample.sensitive_reactions !== 1 ? "s" : ""})`;
        }

        renderProfileDimension(
          container,
          "Controversy Seeking",
          "Avoids Conflict",
          "Seeks Controversy",
          controversyScore,
          controversyLabel,
          controversyConf,
          controversySample
        );
      }
    }

    function update() {
      const user = getSelectedUser();
      const topicFilterValue = topicSelect.value;
      const isAllUsers = userSelect.value === "all";

      try {
        renderMetrics(user, userCount);
        renderEmotionalProfile(user);
        renderDecisionSpeed(user, userMap, isAllUsers);
        
        // Pass click handler to navigate to user profile
        const handleUserClick = (userId) => {
          userSelect.value = userId;
          update();
        };
        
        renderIdeologySpectrum(user, userMap, isAllUsers, handleUserClick);
        
        try {
          renderPsychologicalProfile(user, userMap, isAllUsers);
        } catch (err) {
          console.error("Error rendering psychological profile:", err);
          const container = document.getElementById("psychological-profile");
          if (container) {
            container.textContent = "Error loading psychological profile.";
          }
        }
        
        renderTopics(user, topicFilterValue);
        renderInsights(user, userMap, isAllUsers);
      } catch (err) {
        console.error("Error in update function:", err);
      }
    }

    userSelect.addEventListener("change", update);
    topicSelect.addEventListener("change", update);

    // Initial render
    update();
  } catch (err) {
    console.error("Dashboard init error:", err);
    const errorMsg = err.message || "Unknown error";
    document.getElementById("detail-title").textContent =
      "Failed to load data";
    document.getElementById("detail-subtitle").textContent =
      `Error: ${errorMsg}. Check that the backend is running at ${API_BASE} and events exist.`;
  }
}

init();