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
    if (u.ideology_spectrum) {
      for (const [axis, score] of Object.entries(u.ideology_spectrum)) {
        if (agg.ideology_spectrum[axis] === undefined) {
          agg.ideology_spectrum[axis] = { sum: 0, count: 0 };
        }
        agg.ideology_spectrum[axis].sum += score || 50; // Default to 50 if null
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
      profileSums.engagement_level += p.engagement_level || 0;
      profileSums.emotional_intensity += p.emotional_intensity || 0;
      profileSums.decision_speed_score += p.decision_speed_score || 50;
      profileSums.controversy_seeking += p.controversy_seeking || 0;
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

function renderDecisionSpeed(user) {
  const main = document.getElementById("decision-speed-main");
  const meta = document.getElementById("decision-speed-meta");

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

function renderInsights(user) {
  const ul = document.getElementById("insights-list");
  ul.innerHTML = "";

  const insights = [];

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
      const userScores = [];
      Object.entries(userMap).forEach(([userId, userData]) => {
        if (
          userData.ideology_spectrum &&
          userData.ideology_spectrum[axis.key] !== undefined &&
          userData.ideology_spectrum[axis.key] !== null
        ) {
          userScores.push({
            userId,
            score: userData.ideology_spectrum[axis.key],
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
      userScores.forEach(({ userId, score }) => {
        const clampedScore = Math.max(0, Math.min(100, score));
        const marker = document.createElement("div");
        marker.className = "spectrum-card-marker spectrum-card-marker-clickable";
        marker.style.left = `${clampedScore}%`;
        marker.style.borderColor = userColors[userId] || "#64748b";
        marker.title = `Click to view ${userId}'s profile – ${clampedScore.toFixed(0)}/100 (${clampedScore < 40 ? axis.leftLabel : clampedScore > 60 ? axis.rightLabel : "center"})`;

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
      const score = spectrum[axis.key];
      if (score === undefined || score === null) {
        return; // Skip if no data for this axis
      }

      // Clamp score to 0-100
      const clampedScore = Math.max(0, Math.min(100, score));
      const percentage = clampedScore.toFixed(0);

      // Create spectrum row
      const row = document.createElement("div");
      row.className = "spectrum-row";

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

      // Bar fill (right side - represents right/conservative position)
      const barFillRight = document.createElement("div");
      barFillRight.className = "spectrum-bar-fill spectrum-bar-fill-right";
      barFillRight.style.width = `${clampedScore}%`;

      // Marker at score position
      const marker = document.createElement("div");
      marker.className = "spectrum-marker";
      marker.style.left = `${clampedScore}%`;

      barTrack.appendChild(barFillLeft);
      barTrack.appendChild(barFillRight);
      barTrack.appendChild(marker);
      barContainer.appendChild(barTrack);

      // Right label
      const rightLabelEl = document.createElement("div");
      rightLabelEl.className = "spectrum-label spectrum-label-right";
      rightLabelEl.textContent = axis.rightLabel;

      // Score display
      const scoreEl = document.createElement("div");
      scoreEl.className = "spectrum-score";
      scoreEl.textContent = `${percentage}/100`;

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
      explanation
    ) {
      const dimension = document.createElement("div");
      dimension.className = "psychological-dimension";

      const header = document.createElement("div");
      header.className = "psychological-dimension-header";
      header.textContent = title;
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
      barFill.style.width = `${Math.max(0, Math.min(100, score))}%`;

      const marker = document.createElement("div");
      marker.className = "psychological-bar-marker";
      marker.style.left = `${Math.max(0, Math.min(100, score))}%`;

      barTrack.appendChild(barFill);
      barTrack.appendChild(marker);
      barContainer.appendChild(barTrack);

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
          container.textContent = "No psychological profile data yet.";
          return;
        }

        // Compute averages
        const avgEngagement =
          profiles.reduce((sum, p) => sum + p.profile.engagement_level, 0) /
          profiles.length;
        const avgEmotional =
          profiles.reduce(
            (sum, p) => sum + p.profile.emotional_intensity,
            0
          ) / profiles.length;
        const avgDecisionSpeed =
          profiles.reduce(
            (sum, p) => sum + p.profile.decision_speed_score,
            0
          ) / profiles.length;
        const avgControversy =
          profiles.reduce(
            (sum, p) => sum + p.profile.controversy_seeking,
            0
          ) / profiles.length;

        // Find extremes
        const mostEngaged = profiles.reduce((max, p) =>
          p.profile.engagement_level > max.profile.engagement_level ? p : max
        );
        const mostEmotional = profiles.reduce((max, p) =>
          p.profile.emotional_intensity > max.profile.emotional_intensity
            ? p
            : max
        );
        const mostControversial = profiles.reduce((max, p) =>
          p.profile.controversy_seeking > max.profile.controversy_seeking
            ? p
            : max
        );

        // Render aggregated view
        renderProfileDimension(
          container,
          "Engagement Level",
          "Low",
          "High",
          avgEngagement,
          `Average: ${avgEngagement.toFixed(0)}/100. Most engaged: ${mostEngaged.userId.replace("user", "u")}`
        );

        renderProfileDimension(
          container,
          "Emotional Intensity",
          "Calm / Neutral",
          "Highly Emotional",
          avgEmotional,
          `Average: ${avgEmotional.toFixed(0)}/100. Most emotional: ${mostEmotional.userId.replace("user", "u")}`
        );

        renderProfileDimension(
          container,
          "Decision Speed",
          "Impulsive",
          "Deliberate",
          avgDecisionSpeed,
          `Average: ${avgDecisionSpeed.toFixed(0)}/100 (balanced = 50)`
        );

        renderProfileDimension(
          container,
          "Controversy Seeking",
          "Avoids Conflict",
          "Seeks Controversy",
          avgControversy,
          `Average: ${avgControversy.toFixed(0)}/100. Most controversy-seeking: ${mostControversial.userId.replace("user", "u")}`
        );
      } else {
        // Single user mode
        const profile = user.psychological_profile;
        if (!profile) {
          container.textContent =
            "No psychological profile data yet. React to posts to generate profile.";
          return;
        }

        // Engagement Level
        let engagementLabel = "";
        if (profile.engagement_level <= 30) {
          engagementLabel = "Low engagement (skims the feed)";
        } else if (profile.engagement_level <= 70) {
          engagementLabel = "Moderate engagement";
        } else {
          engagementLabel = "High engagement (often absorbed in the feed)";
        }

        renderProfileDimension(
          container,
          "Engagement Level",
          "Low",
          "High",
          profile.engagement_level,
          engagementLabel
        );

        // Emotional Intensity
        let emotionalLabel = "";
        if (profile.emotional_intensity <= 30) {
          emotionalLabel = "Mostly neutral or light reactions";
        } else if (profile.emotional_intensity <= 70) {
          emotionalLabel = "Shows emotions regularly";
        } else {
          emotionalLabel = "Highly emotionally reactive";
        }

        renderProfileDimension(
          container,
          "Emotional Intensity",
          "Calm / Neutral",
          "Highly Emotional",
          profile.emotional_intensity,
          emotionalLabel
        );

        // Decision Speed
        let decisionLabel = "";
        const latency = profile.avg_latency_seconds;
        if (profile.decision_speed === "impulsive") {
          decisionLabel = `Usually reacts quickly without much hesitation (${latency}s average).`;
        } else if (profile.decision_speed === "balanced") {
          decisionLabel = `Takes moderate time before reacting (${latency}s average).`;
        } else {
          decisionLabel = `Takes time before reacting to most posts (${latency}s average).`;
        }

        renderProfileDimension(
          container,
          "Decision Speed",
          "Impulsive",
          "Deliberate",
          profile.decision_speed_score,
          decisionLabel
        );

        // Controversy Seeking
        let controversyLabel = "";
        if (profile.controversy_seeking <= 30) {
          controversyLabel = "Avoids controversial topics";
        } else if (profile.controversy_seeking <= 70) {
          controversyLabel = "Engages with some sensitive content";
        } else {
          controversyLabel = "Strong attraction to divisive topics";
        }

        renderProfileDimension(
          container,
          "Controversy Seeking",
          "Avoids Conflict",
          "Seeks Controversy",
          profile.controversy_seeking,
          controversyLabel
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
        renderDecisionSpeed(user);
        
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
        renderInsights(user);
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