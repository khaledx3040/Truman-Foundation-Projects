// --- Config -------------------------------------------------------------

const API_BASE = "http://127.0.0.1:5000";

// --- Session state ------------------------------------------------------

let currentUserId = null;
let currentSessionId = null;
let maxScroll = 0;

// Dwell-time state
let currentFocusedPostId = null;
let currentPostStartMs = null;
const firstSeen = {}; // postId -> first time it became the focused post (ms)

// Visibility tracking
let postObserver = null;
let visibilityMap = {}; // postId -> intersectionRatio

// --- DOM references -----------------------------------------------------

const loginView = document.getElementById("login-view");
const feedView = document.getElementById("feed-view");
const loginForm = document.getElementById("login-form");
const accountSelect = document.getElementById("account-select");
const currentUserLabel = document.getElementById("current-user-label");
const logoutBtn = document.getElementById("logout-btn");
const refreshBtn = document.getElementById("refresh-btn");
const postsContainer = document.querySelector(".posts-container");

// --- Helpers ------------------------------------------------------------

function createSessionId(userId) {
  if (window.crypto && crypto.randomUUID) {
    return `${userId}-${crypto.randomUUID()}`;
  }
  return `${userId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function sendEvent(payload) {
  if (!currentSessionId) return;

  const body = {
    session_id: currentSessionId,
    ...payload,
  };

  try {
    await fetch(`${API_BASE}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("Failed to send event", err);
  }
}

function getScrollPercent() {
  const scrollTop = window.scrollY || window.pageYOffset;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  if (docHeight <= 0) return 100;
  return Math.round((scrollTop / docHeight) * 100);
}

function shufflePosts() {
  if (!postsContainer) return;

  const postsArray = Array.from(postsContainer.querySelectorAll(".post"));

  for (let i = postsArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [postsArray[i], postsArray[j]] = [postsArray[j], postsArray[i]];
  }

  postsContainer.innerHTML = "";
  postsArray.forEach((post) => postsContainer.appendChild(post));
}

// --- Focus / visibility logic ------------------------------------------

function applyPostClasses(activeId) {
  document.querySelectorAll(".post").forEach((post) => {
    const id = post.dataset.postId;
    const isActive = activeId && id === activeId;
    post.classList.toggle("post-active", isActive);
    post.classList.toggle("post-dimmed", activeId && id !== activeId);
  });
}

function updateFocusedPostFromVisibility() {
  let bestId = null;
  let bestRatio = 0;

  for (const [postId, ratio] of Object.entries(visibilityMap)) {
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestId = postId;
    }
  }

  // Require at least 40% of the card to be visible to count as "focused"
  if (!bestId || bestRatio < 0.4) {
    return;
  }

  const now = Date.now();

  if (bestId === currentFocusedPostId) {
    return; // no change
  }

  // End previous view
  if (currentFocusedPostId && currentPostStartMs != null) {
    const dwellMs = now - currentPostStartMs;
    sendEvent({
      event_type: "post_view_end",
      element_id: currentFocusedPostId,
      // reuse scroll_depth column as "dwell_ms" for this event type
      scroll_depth: dwellMs,
    });
  }

  // Start new view
  currentFocusedPostId = bestId;
  currentPostStartMs = now;

  if (!firstSeen[bestId]) {
    firstSeen[bestId] = now;
  }

  sendEvent({
    event_type: "post_view_start",
    element_id: bestId,
  });

  applyPostClasses(bestId);
}

function setupPostObserver() {
  if (postObserver) {
    postObserver.disconnect();
  }
  visibilityMap = {};

  postObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const post = entry.target;
        const id = post.dataset.postId;
        if (!id) return;
  
        const ratio = entry.intersectionRatio;
  
        if (ratio <= 0) {
          delete visibilityMap[id];
        } else {
          visibilityMap[id] = ratio;
        }
      });
  
      updateFocusedPostFromVisibility();
    },
    {
      root: null,
      rootMargin: "-150px 0px 0px 0px",
      threshold: [0, 0.25, 0.4, 0.5, 0.75, 1],
    }
  );

  document.querySelectorAll(".post").forEach((post) => {
    postObserver.observe(post);
  });

  // initial evaluation once layout settles
  setTimeout(updateFocusedPostFromVisibility, 150);
}

// --- Scroll handling (only for scroll depth now) -----------------------

function handleScrollUpdate() {
  const percent = getScrollPercent();
  if (percent > maxScroll) {
    maxScroll = percent;
    sendEvent({
      event_type: "scroll",
      scroll_depth: maxScroll,
    });
  }
}

// --- Event wiring -------------------------------------------------------

loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const selected = accountSelect.value;
  if (!selected) return;

  // 🔹 If admin is chosen, go to the director dashboard instead of the feed
  if (selected === "admin") {
    window.location.href = "admin.html";
    return;
  }

  // normal user flow
  currentUserId = selected;
  currentSessionId = createSessionId(currentUserId);
  maxScroll = 0;
  currentFocusedPostId = null;
  currentPostStartMs = null;

  currentUserLabel.textContent = `Logged in as: ${currentUserId}`;
  loginView.classList.add("hidden");
  feedView.classList.remove("hidden");

  shufflePosts();
  setupPostObserver();
  applyPostClasses(null);

  sendEvent({
    event_type: "page_view",
    element_id: "behaviour_feed",
  });
});

logoutBtn.addEventListener("click", () => {
  if (!currentSessionId) return;

  const now = Date.now();

  if (currentFocusedPostId && currentPostStartMs != null) {
    const dwellMs = now - currentPostStartMs;
    sendEvent({
      event_type: "post_view_end",
      element_id: currentFocusedPostId,
      scroll_depth: dwellMs,
    });
  }

  sendEvent({
    event_type: "session_end",
    scroll_depth: maxScroll,
  });

  currentSessionId = null;
  currentUserId = null;
  currentFocusedPostId = null;
  currentPostStartMs = null;
  applyPostClasses(null);

  if (postObserver) {
    postObserver.disconnect();
    postObserver = null;
    visibilityMap = {};
  }

  feedView.classList.add("hidden");
  loginView.classList.remove("hidden");
  currentUserLabel.textContent = "";
});

// Refresh feed → reshuffle + re-observe + log refresh
refreshBtn.addEventListener("click", () => {
  if (!currentSessionId) return;
  shufflePosts();
  setupPostObserver();
  applyPostClasses(null);

  sendEvent({
    event_type: "feed_refresh",
  });
});

// Scroll: only scroll depth here (focus handled by IntersectionObserver)
let scrollTimer = null;
window.addEventListener("scroll", () => {
  if (!currentSessionId) return;

  if (scrollTimer) return;
  scrollTimer = setTimeout(() => {
    handleScrollUpdate();
    scrollTimer = null;
  }, 200);
});

// --- Reaction buttons with latency + Facebook-style toggle -------------

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".reaction-btn");
  if (!btn) return;
  if (!currentSessionId) return;

  const post = btn.closest(".post");
  if (!post) return;

  const postId = post.dataset.postId;
  const reaction = btn.dataset.reaction;
  const now = Date.now();

  const allBtns = post.querySelectorAll(".reaction-btn");
  const alreadyActive = btn.classList.contains("active");

  // Clear active state on all buttons for this post
  allBtns.forEach((b) => b.classList.remove("active"));

  let finalReaction = null;

  // If it wasn't active, activate it (select reaction)
  if (!alreadyActive) {
    btn.classList.add("active");
    finalReaction = reaction;
  }
  // If it was active, we just cleared it → reaction_removed

  // Compute latency (first time the post ever became focused)
  let latencyMs = null;
  if (postId && firstSeen[postId]) {
    latencyMs = now - firstSeen[postId];
  }

  sendEvent({
    event_type: finalReaction ? "reaction" : "reaction_removed",
    element_id: postId,
    reaction_type: finalReaction,
    // reuse scroll_depth as latency_ms for this event
    scroll_depth: latencyMs,
  });
});

// --- Session end on tab close/refresh ----------------------------------

window.addEventListener("beforeunload", () => {
  if (!currentSessionId) return;

  const now = Date.now();
  const events = [];

  if (currentFocusedPostId && currentPostStartMs != null) {
    const dwellMs = now - currentPostStartMs;
    events.push({
      event_type: "post_view_end",
      element_id: currentFocusedPostId,
      scroll_depth: dwellMs,
    });
  }

  events.push({
    event_type: "session_end",
    scroll_depth: maxScroll,
  });

  events.forEach((payload) => {
    const body = {
      session_id: currentSessionId,
      ...payload,
    };
    try {
      fetch(`${API_BASE}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      });
    } catch {
      // ignore errors on unload
    }
  });
});