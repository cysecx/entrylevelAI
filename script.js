const apiBase = "";

const state = {
  token: localStorage.getItem("launchpad_token") || "",
  user: null,
  jobs: []
};

function $(id) {
  return document.querySelector(id);
}

function bind(el, event, handler) {
  if (el) el.addEventListener(event, handler);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function loadCurrentUser() {
  const authStatusEl = $("#authStatus");
  if (!state.token) {
    state.user = null;
    if (authStatusEl) authStatusEl.textContent = "Not logged in.";
    return;
  }
  try {
    const data = await apiFetch("/api/auth/me", { method: "GET", headers: {} });
    state.user = data.user;
    if (authStatusEl) {
      authStatusEl.textContent = `Logged in as ${state.user.name} (${state.user.email}) | Plan: ${state.user.plan}`;
    }
  } catch {
    state.token = "";
    state.user = null;
    localStorage.removeItem("launchpad_token");
    if (authStatusEl) authStatusEl.textContent = "Not logged in.";
  }
}

async function signup() {
  try {
    const data = await apiFetch("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        name: $("#signupName")?.value?.trim() || "",
        email: $("#signupEmail")?.value?.trim().toLowerCase() || "",
        password: $("#signupPassword")?.value || ""
      })
    });
    state.token = data.token;
    localStorage.setItem("launchpad_token", state.token);
    await loadCurrentUser();
    await loadSavedJobs();
    await loadApplications();
  } catch (error) {
    alert(error.message);
  }
}

async function login() {
  try {
    const data = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: $("#loginEmail")?.value?.trim().toLowerCase() || "",
        password: $("#loginPassword")?.value || ""
      })
    });
    state.token = data.token;
    localStorage.setItem("launchpad_token", state.token);
    await loadCurrentUser();
    await loadSavedJobs();
    await loadApplications();
  } catch (error) {
    alert(error.message);
  }
}

function logout() {
  state.token = "";
  state.user = null;
  localStorage.removeItem("launchpad_token");
  const authStatusEl = $("#authStatus");
  if (authStatusEl) authStatusEl.textContent = "Not logged in.";
  const savedJobsEl = $("#savedJobs");
  const trackerTableWrapEl = $("#trackerTableWrap");
  if (savedJobsEl) savedJobsEl.innerHTML = "";
  if (trackerTableWrapEl) trackerTableWrapEl.innerHTML = "";
}

function renderJobResults(jobs) {
  const jobResultsEl = $("#jobResults");
  if (!jobResultsEl) return;
  if (!jobs.length) {
    jobResultsEl.innerHTML = `<article class="result-item"><h4>No close matches yet</h4><p class="result-meta">Try adding more skills.</p></article>`;
    return;
  }
  jobResultsEl.innerHTML = jobs
    .map(
      (job, idx) => `
      <article class="result-item">
        <h4>${escapeHtml(job.title)} - ${escapeHtml(job.company)}</h4>
        <p class="result-meta">${escapeHtml(job.location)} | ${escapeHtml(job.type)} | ${escapeHtml(job.track)}</p>
        <p class="fit">Qualification fit: ${Number(job.score || 0)}% (${Number(job.matchCount || 0)} skill matches)</p>
        <div class="result-actions">
          <button class="btn ghost save-job-btn" data-index="${idx}">Save Job</button>
          ${
            job.url
              ? `<a class="btn ghost" href="${escapeHtml(job.url)}" target="_blank" rel="noopener noreferrer">Apply Link</a>`
              : ""
          }
        </div>
      </article>
    `
    )
    .join("");

  document.querySelectorAll(".save-job-btn").forEach((btn) => {
    bind(btn, "click", async () => {
      if (!state.user) {
        alert("Please log in first.");
        return;
      }
      const job = state.jobs[Number(btn.dataset.index)];
      try {
        await apiFetch("/api/saved-jobs", { method: "POST", body: JSON.stringify(job) });
        await loadSavedJobs();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

async function findJobs() {
  const findJobsBtn = $("#findJobsBtn");
  if (!findJobsBtn) return;

  findJobsBtn.disabled = true;
  findJobsBtn.textContent = "Searching...";
  const query = new URLSearchParams({
    source: $("#jobSource")?.value || "live",
    jobType: $("#jobType")?.value || "all",
    track: $("#careerTrack")?.value || "all",
    skills: $("#skillsInput")?.value?.trim() || "",
    location: $("#locationInput")?.value?.trim() || ""
  });

  try {
    const data = await apiFetch(`/api/jobs/search?${query.toString()}`, { method: "GET", headers: {} });
    state.jobs = data.jobs || [];
    renderJobResults(state.jobs);
  } catch (error) {
    const jobResultsEl = $("#jobResults");
    if (jobResultsEl) {
      jobResultsEl.innerHTML = `<article class="result-item"><h4>Could not load jobs</h4><p class="result-meta">${escapeHtml(
        error.message
      )}</p></article>`;
    }
  } finally {
    findJobsBtn.disabled = false;
    findJobsBtn.textContent = "Find Matching Jobs";
  }
}

async function analyzeResume() {
  if (!state.user) {
    alert("Please log in first.");
    return;
  }
  const atsScoreCardEl = $("#atsScoreCard");
  if (!atsScoreCardEl) return;
  try {
    const data = await apiFetch("/api/resume/analyze", {
      method: "POST",
      body: JSON.stringify({
        resumeText: $("#resumeText")?.value || "",
        jobDescText: $("#jobDescText")?.value || ""
      })
    });
    atsScoreCardEl.classList.remove("hidden");
    atsScoreCardEl.innerHTML = `
      <p class="score-headline">ATS Match Score: ${data.score}%</p>
      <p><strong>Matched Keywords:</strong> ${escapeHtml((data.matchedKeywords || []).join(", ") || "None yet")}</p>
      <p><strong>Missing Keywords:</strong> ${escapeHtml((data.missingKeywords || []).join(", ") || "Great coverage")}</p>
      <ul>${(data.suggestions || []).map((tip) => `<li>${escapeHtml(tip)}</li>`).join("")}</ul>
    `;
  } catch (error) {
    alert(error.message);
  }
}

function handleResumeUpload(event) {
  const uploadStatusEl = $("#uploadStatus");
  const resumeTextEl = $("#resumeText");
  const file = event.target.files?.[0];
  if (!file || !uploadStatusEl) return;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "txt") {
    const reader = new FileReader();
    reader.onload = () => {
      if (resumeTextEl) resumeTextEl.value = String(reader.result || "");
      uploadStatusEl.textContent = `Loaded ${file.name}.`;
    };
    reader.readAsText(file);
    return;
  }
  uploadStatusEl.textContent = `${file.name} attached. Paste extracted text for ATS scoring.`;
}

async function loadSavedJobs() {
  const savedJobsEl = $("#savedJobs");
  if (!savedJobsEl) return;
  if (!state.user) {
    savedJobsEl.innerHTML = `<p class="result-meta">Log in to view saved jobs.</p>`;
    return;
  }
  try {
    const data = await apiFetch("/api/saved-jobs", { method: "GET", headers: {} });
    const items = data.savedJobs || [];
    if (!items.length) {
      savedJobsEl.innerHTML = `<p class="result-meta">No saved jobs yet.</p>`;
      return;
    }
    savedJobsEl.innerHTML = items
      .map(
        (item) => `
        <article class="result-item">
          <h4>${escapeHtml(item.title)} - ${escapeHtml(item.company)}</h4>
          <p class="result-meta">${escapeHtml(item.location)} | ${escapeHtml(item.job_type)}</p>
          <div class="result-actions">
            <button class="btn ghost delete-saved-btn" data-id="${item.id}">Remove</button>
            ${item.url ? `<a class="btn ghost" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Open Job</a>` : ""}
          </div>
        </article>
      `
      )
      .join("");

    document.querySelectorAll(".delete-saved-btn").forEach((btn) => {
      bind(btn, "click", async () => {
        try {
          await apiFetch(`/api/saved-jobs/${btn.dataset.id}`, { method: "DELETE", headers: {} });
          await loadSavedJobs();
        } catch (error) {
          alert(error.message);
        }
      });
    });
  } catch (error) {
    savedJobsEl.innerHTML = `<p class="result-meta">${escapeHtml(error.message)}</p>`;
  }
}

async function addApplication() {
  if (!state.user) {
    alert("Please log in first.");
    return;
  }
  try {
    await apiFetch("/api/applications", {
      method: "POST",
      body: JSON.stringify({
        company: $("#trackCompany")?.value?.trim() || "",
        role: $("#trackRole")?.value?.trim() || "",
        stage: $("#trackStage")?.value || "Applied",
        date: $("#trackDate")?.value || ""
      })
    });
    await loadApplications();
  } catch (error) {
    alert(error.message);
  }
}

async function loadApplications() {
  const trackerTableWrapEl = $("#trackerTableWrap");
  if (!trackerTableWrapEl) return;
  if (!state.user) {
    trackerTableWrapEl.innerHTML = `<p class="result-meta">Log in to track applications.</p>`;
    return;
  }
  try {
    const data = await apiFetch("/api/applications", { method: "GET", headers: {} });
    const items = data.applications || [];
    if (!items.length) {
      trackerTableWrapEl.innerHTML = `<p class="result-meta">No applications tracked yet.</p>`;
      return;
    }
    trackerTableWrapEl.innerHTML = `
      <table>
        <thead><tr><th>Company</th><th>Role</th><th>Stage</th><th>Date</th><th>Action</th></tr></thead>
        <tbody>
          ${items
            .map(
              (item) => `
              <tr>
                <td>${escapeHtml(item.company)}</td>
                <td>${escapeHtml(item.role)}</td>
                <td>${escapeHtml(item.stage)}</td>
                <td>${escapeHtml(item.app_date || "-")}</td>
                <td><button class="btn ghost delete-app-btn" data-id="${item.id}">Delete</button></td>
              </tr>
            `
            )
            .join("")}
        </tbody>
      </table>
    `;
    document.querySelectorAll(".delete-app-btn").forEach((btn) => {
      bind(btn, "click", async () => {
        try {
          await apiFetch(`/api/applications/${btn.dataset.id}`, { method: "DELETE", headers: {} });
          await loadApplications();
        } catch (error) {
          alert(error.message);
        }
      });
    });
  } catch (error) {
    trackerTableWrapEl.innerHTML = `<p class="result-meta">${escapeHtml(error.message)}</p>`;
  }
}

async function chooseTier(plan) {
  if (!state.user) {
    alert("Please log in first.");
    return;
  }
  try {
    const data = await apiFetch("/api/stripe/create-checkout-session", {
      method: "POST",
      body: JSON.stringify({ plan })
    });
    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
      return;
    }
    await loadCurrentUser();
    alert(data.message || `Plan updated to ${plan}.`);
  } catch (error) {
    alert(error.message);
  }
}

async function loadAnalytics() {
  const analyticsWrapEl = $("#analyticsWrap");
  if (!analyticsWrapEl) return;
  if (!state.user) {
    analyticsWrapEl.innerHTML = `<p class="result-meta">Please log in as admin.</p>`;
    return;
  }
  try {
    const data = await apiFetch("/api/admin/analytics", { method: "GET", headers: {} });
    const a = data.analytics;
    analyticsWrapEl.innerHTML = `
      <div class="kpi-grid">
        <article class="kpi"><p>Total Users</p><strong>${a.totalUsers}</strong></article>
        <article class="kpi"><p>Saved Jobs</p><strong>${a.totalSavedJobs}</strong></article>
        <article class="kpi"><p>Applications</p><strong>${a.totalApplications}</strong></article>
        <article class="kpi"><p>ATS Analyses</p><strong>${a.totalAtsAnalyses}</strong></article>
      </div>
    `;
  } catch (error) {
    analyticsWrapEl.innerHTML = `<p class="result-meta">${escapeHtml(error.message)}</p>`;
  }
}

function initBindings() {
  bind($("#signupBtn"), "click", signup);
  bind($("#loginBtn"), "click", login);
  bind($("#logoutBtn"), "click", logout);
  bind($("#findJobsBtn"), "click", findJobs);
  bind($("#analyzeResumeBtn"), "click", analyzeResume);
  bind($("#resumeUploadInput"), "change", handleResumeUpload);
  bind($("#addTrackerBtn"), "click", addApplication);
  bind($("#loadAnalyticsBtn"), "click", loadAnalytics);

  document.querySelectorAll(".tier-btn").forEach((button) => {
    bind(button, "click", () => chooseTier(button.dataset.tier));
  });
}

async function bootstrap() {
  initBindings();
  await loadCurrentUser();
  if ($("#findJobsBtn")) await findJobs();
  if ($("#savedJobs")) await loadSavedJobs();
  if ($("#trackerTableWrap")) await loadApplications();
}

bootstrap();
