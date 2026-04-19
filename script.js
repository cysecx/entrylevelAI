const apiBase = "";

const state = {
  token: localStorage.getItem("launchpad_token") || "",
  user: null,
  jobs: []
};

const jobSourceEl = document.querySelector("#jobSource");
const jobTypeEl = document.querySelector("#jobType");
const careerTrackEl = document.querySelector("#careerTrack");
const skillsInputEl = document.querySelector("#skillsInput");
const locationInputEl = document.querySelector("#locationInput");
const findJobsBtn = document.querySelector("#findJobsBtn");
const jobResultsEl = document.querySelector("#jobResults");

const resumeTextEl = document.querySelector("#resumeText");
const jobDescTextEl = document.querySelector("#jobDescText");
const analyzeResumeBtn = document.querySelector("#analyzeResumeBtn");
const atsScoreCardEl = document.querySelector("#atsScoreCard");
const resumeUploadInput = document.querySelector("#resumeUploadInput");
const uploadStatusEl = document.querySelector("#uploadStatus");

const signupNameEl = document.querySelector("#signupName");
const signupEmailEl = document.querySelector("#signupEmail");
const signupPasswordEl = document.querySelector("#signupPassword");
const loginEmailEl = document.querySelector("#loginEmail");
const loginPasswordEl = document.querySelector("#loginPassword");
const signupBtn = document.querySelector("#signupBtn");
const loginBtn = document.querySelector("#loginBtn");
const logoutBtn = document.querySelector("#logoutBtn");
const authStatusEl = document.querySelector("#authStatus");

const savedJobsEl = document.querySelector("#savedJobs");
const trackCompanyEl = document.querySelector("#trackCompany");
const trackRoleEl = document.querySelector("#trackRole");
const trackStageEl = document.querySelector("#trackStage");
const trackDateEl = document.querySelector("#trackDate");
const addTrackerBtn = document.querySelector("#addTrackerBtn");
const trackerTableWrapEl = document.querySelector("#trackerTableWrap");

const loadAnalyticsBtn = document.querySelector("#loadAnalyticsBtn");
const analyticsWrapEl = document.querySelector("#analyticsWrap");

const openPaywallBtn = document.querySelector("#openPaywallBtn");
const closePaywallBtn = document.querySelector("#closePaywallBtn");
const closePaywallBackdrop = document.querySelector("#closePaywallBackdrop");
const paywallModal = document.querySelector("#paywallModal");
const tierButtons = document.querySelectorAll(".tier-btn");

async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function openPaywall() {
  paywallModal.classList.remove("hidden");
  paywallModal.setAttribute("aria-hidden", "false");
}

function closePaywall() {
  paywallModal.classList.add("hidden");
  paywallModal.setAttribute("aria-hidden", "true");
}

function renderAuthStatus() {
  if (!state.user) {
    authStatusEl.textContent = "Not logged in.";
    return;
  }
  authStatusEl.textContent = `Logged in as ${state.user.name} (${state.user.email}) | Plan: ${state.user.plan}`;
}

function renderJobResults(jobs) {
  if (!jobs.length) {
    jobResultsEl.innerHTML = `
      <article class="result-item">
        <h4>No close matches yet</h4>
        <p class="result-meta">Try adding more skills or setting Job type to All.</p>
      </article>
    `;
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
    btn.addEventListener("click", async () => {
      if (!state.user) {
        alert("Please log in first.");
        return;
      }
      const job = state.jobs[Number(btn.dataset.index)];
      try {
        await apiFetch("/api/saved-jobs", {
          method: "POST",
          body: JSON.stringify(job)
        });
        await loadSavedJobs();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

async function findJobs() {
  findJobsBtn.disabled = true;
  findJobsBtn.textContent = "Searching...";
  const query = new URLSearchParams({
    source: jobSourceEl.value,
    jobType: jobTypeEl.value,
    track: careerTrackEl.value,
    skills: skillsInputEl.value.trim(),
    location: locationInputEl.value.trim()
  });

  try {
    const data = await apiFetch(`/api/jobs/search?${query.toString()}`, { method: "GET", headers: {} });
    state.jobs = data.jobs || [];
    renderJobResults(state.jobs);
  } catch (error) {
    alert(error.message);
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
  try {
    const data = await apiFetch("/api/resume/analyze", {
      method: "POST",
      body: JSON.stringify({
        resumeText: resumeTextEl.value,
        jobDescText: jobDescTextEl.value
      })
    });
    atsScoreCardEl.classList.remove("hidden");
    atsScoreCardEl.innerHTML = `
      <p class="score-headline">ATS Match Score: ${data.score}%</p>
      <p><strong>Matched Keywords:</strong> ${escapeHtml((data.matchedKeywords || []).join(", ") || "None yet")}</p>
      <p><strong>Missing Keywords:</strong> ${escapeHtml((data.missingKeywords || []).join(", ") || "Great coverage")}</p>
      <p><strong>Resume Rewrite Suggestions:</strong></p>
      <ul>${(data.suggestions || []).map((tip) => `<li>${escapeHtml(tip)}</li>`).join("")}</ul>
    `;
  } catch (error) {
    alert(error.message);
  }
}

function handleResumeUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "txt") {
    const reader = new FileReader();
    reader.onload = () => {
      resumeTextEl.value = String(reader.result || "");
      uploadStatusEl.textContent = `Loaded ${file.name}.`;
    };
    reader.readAsText(file);
    return;
  }
  uploadStatusEl.textContent = `${file.name} attached. Paste extracted text into Resume text for ATS scoring.`;
}

async function signup() {
  try {
    const data = await apiFetch("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        name: signupNameEl.value.trim(),
        email: signupEmailEl.value.trim().toLowerCase(),
        password: signupPasswordEl.value
      })
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("launchpad_token", state.token);
    renderAuthStatus();
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
        email: loginEmailEl.value.trim().toLowerCase(),
        password: loginPasswordEl.value
      })
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("launchpad_token", state.token);
    renderAuthStatus();
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
  renderAuthStatus();
  savedJobsEl.innerHTML = "";
  trackerTableWrapEl.innerHTML = "";
}

async function loadSavedJobs() {
  if (!state.user) {
    savedJobsEl.innerHTML = `<p class="result-meta">Log in to view saved jobs.</p>`;
    return;
  }
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
        <p class="result-meta">${escapeHtml(item.location)} | ${escapeHtml(item.job_type)} | ${escapeHtml(item.track)}</p>
        <div class="result-actions">
          <button class="btn ghost delete-saved-btn" data-id="${item.id}">Remove</button>
          ${item.url ? `<a class="btn ghost" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Open Job</a>` : ""}
        </div>
      </article>
    `
    )
    .join("");

  document.querySelectorAll(".delete-saved-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await apiFetch(`/api/saved-jobs/${btn.dataset.id}`, { method: "DELETE", headers: {} });
        await loadSavedJobs();
      } catch (error) {
        alert(error.message);
      }
    });
  });
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
        company: trackCompanyEl.value.trim(),
        role: trackRoleEl.value.trim(),
        stage: trackStageEl.value,
        date: trackDateEl.value
      })
    });
    await loadApplications();
    trackCompanyEl.value = "";
    trackRoleEl.value = "";
  } catch (error) {
    alert(error.message);
  }
}

async function loadApplications() {
  if (!state.user) {
    trackerTableWrapEl.innerHTML = `<p class="result-meta">Log in to track applications.</p>`;
    return;
  }
  const data = await apiFetch("/api/applications", { method: "GET", headers: {} });
  const items = data.applications || [];
  if (!items.length) {
    trackerTableWrapEl.innerHTML = `<p class="result-meta">No applications tracked yet.</p>`;
    return;
  }

  trackerTableWrapEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Company</th>
          <th>Role</th>
          <th>Stage</th>
          <th>Date</th>
          <th>Action</th>
        </tr>
      </thead>
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
    btn.addEventListener("click", async () => {
      try {
        await apiFetch(`/api/applications/${btn.dataset.id}`, { method: "DELETE", headers: {} });
        await loadApplications();
      } catch (error) {
        alert(error.message);
      }
    });
  });
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
    closePaywall();
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
  if (!state.user) {
    alert("Please log in first.");
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
      <article class="result-item">
        <h4>Plan Breakdown</h4>
        <p class="result-meta">${(a.planBreakdown || []).map((p) => `${p.plan}: ${p.count}`).join(" | ") || "No data"}</p>
      </article>
      <article class="result-item">
        <h4>Application Stage Breakdown</h4>
        <p class="result-meta">${(a.stageBreakdown || []).map((s) => `${s.stage}: ${s.count}`).join(" | ") || "No data"}</p>
      </article>
    `;
  } catch (error) {
    analyticsWrapEl.innerHTML = `<p class="result-meta">${escapeHtml(error.message)}</p>`;
  }
}

async function loadCurrentUser() {
  if (!state.token) {
    state.user = null;
    renderAuthStatus();
    return;
  }
  try {
    const data = await apiFetch("/api/auth/me", { method: "GET", headers: {} });
    state.user = data.user;
    renderAuthStatus();
  } catch {
    state.token = "";
    state.user = null;
    localStorage.removeItem("launchpad_token");
    renderAuthStatus();
  }
}

findJobsBtn.addEventListener("click", findJobs);
analyzeResumeBtn.addEventListener("click", analyzeResume);
resumeUploadInput.addEventListener("change", handleResumeUpload);
signupBtn.addEventListener("click", signup);
loginBtn.addEventListener("click", login);
logoutBtn.addEventListener("click", logout);
addTrackerBtn.addEventListener("click", addApplication);
loadAnalyticsBtn.addEventListener("click", loadAnalytics);

openPaywallBtn.addEventListener("click", openPaywall);
closePaywallBtn.addEventListener("click", closePaywall);
closePaywallBackdrop.addEventListener("click", closePaywall);
tierButtons.forEach((button) => {
  button.addEventListener("click", () => chooseTier(button.dataset.tier));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePaywall();
});

async function bootstrap() {
  renderAuthStatus();
  await loadCurrentUser();
  await findJobs();
  await loadSavedJobs();
  await loadApplications();
}

bootstrap();
