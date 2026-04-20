const apiBase = "";

const state = {
  token: localStorage.getItem("launchpad_token") || "",
  user: null,
  jobs: []
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function bind(element, eventName, handler) {
  if (element) element.addEventListener(eventName, handler);
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
  const headers = { ...(options.headers || {}) };
  const isFormData = options.body instanceof FormData;
  if (!isFormData) headers["Content-Type"] = headers["Content-Type"] || "application/json";
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function setAuthStatus(message) {
  const authStatusEl = $("#authStatus");
  if (authStatusEl) authStatusEl.textContent = message;
}

async function loadCurrentUser() {
  if (!state.token) {
    state.user = null;
    setAuthStatus("Not logged in.");
    return;
  }
  try {
    const data = await apiFetch("/api/auth/me", { method: "GET" });
    state.user = data.user;
    setAuthStatus(`Logged in as ${state.user.name} (${state.user.email}) | Plan: ${state.user.plan}`);
  } catch {
    state.token = "";
    state.user = null;
    localStorage.removeItem("launchpad_token");
    setAuthStatus("Not logged in.");
  }
}

async function signup() {
  try {
    const payload = {
      name: $("#signupName")?.value?.trim() || "",
      email: $("#signupEmail")?.value?.trim().toLowerCase() || "",
      password: $("#signupPassword")?.value || ""
    };
    const data = await apiFetch("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.token = data.token;
    localStorage.setItem("launchpad_token", state.token);
    await postLoginRefresh();
  } catch (error) {
    alert(error.message);
  }
}

async function login() {
  try {
    const payload = {
      email: $("#loginEmail")?.value?.trim().toLowerCase() || "",
      password: $("#loginPassword")?.value || ""
    };
    const data = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.token = data.token;
    localStorage.setItem("launchpad_token", state.token);
    await postLoginRefresh();
  } catch (error) {
    alert(error.message);
  }
}

async function postLoginRefresh() {
  await loadCurrentUser();
  await Promise.all([loadSavedJobs(), loadApplications()]);
}

function logout() {
  state.token = "";
  state.user = null;
  localStorage.removeItem("launchpad_token");
  setAuthStatus("Not logged in.");
  if ($("#savedJobs")) $("#savedJobs").innerHTML = "";
  if ($("#trackerTableWrap")) $("#trackerTableWrap").innerHTML = "";
}

function renderJobResults(jobs) {
  const resultsEl = $("#jobResults");
  if (!resultsEl) return;
  if (!jobs.length) {
    resultsEl.innerHTML = `<article class="result-item"><h4>No matches found</h4><p class="result-meta">Try changing track, location, or skills.</p></article>`;
    return;
  }

  resultsEl.innerHTML = jobs
    .map(
      (job, idx) => `
      <article class="result-item">
        <h4>${escapeHtml(job.title)} - ${escapeHtml(job.company)}</h4>
        <p class="result-meta">${escapeHtml(job.location)} | ${escapeHtml(job.type)} | ${escapeHtml(job.track)}</p>
        <p class="fit">Match Score: ${Number(job.score || 0)}% (${Number(job.matchCount || 0)} matching skills)</p>
        <div class="result-actions">
          <button class="btn ghost save-job-btn" data-index="${idx}">Save Job</button>
          ${
            job.url
              ? `<a class="btn ghost" href="${escapeHtml(job.url)}" target="_blank" rel="noopener noreferrer">Open Listing</a>`
              : ""
          }
        </div>
      </article>
    `
    )
    .join("");

  $$(".save-job-btn").forEach((button) => {
    bind(button, "click", async () => {
      if (!state.user) {
        alert("Please log in first.");
        return;
      }
      try {
        const job = state.jobs[Number(button.dataset.index)];
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
  const button = $("#findJobsBtn");
  if (!button) return;

  button.disabled = true;
  button.textContent = "Searching...";
  const query = new URLSearchParams({
    source: $("#jobSource")?.value || "live",
    jobType: $("#jobType")?.value || "all",
    track: $("#careerTrack")?.value || "all",
    skills: $("#skillsInput")?.value?.trim() || "",
    location: $("#locationInput")?.value?.trim() || ""
  });

  try {
    const data = await apiFetch(`/api/jobs/search?${query.toString()}`, { method: "GET" });
    state.jobs = data.jobs || [];
    renderJobResults(state.jobs);
  } catch (error) {
    renderJobResults([]);
    if ($("#jobResults")) {
      $("#jobResults").insertAdjacentHTML(
        "beforeend",
        `<article class="result-item"><p class="result-meta">${escapeHtml(error.message)}</p></article>`
      );
    }
  } finally {
    button.disabled = false;
    button.textContent = "Find Matches";
  }
}

async function extractResumeFromUpload(file) {
  const form = new FormData();
  form.append("resume", file);
  return apiFetch("/api/resume/extract", {
    method: "POST",
    body: form
  });
}

async function handleResumeUpload(event) {
  const uploadStatusEl = $("#uploadStatus");
  const resumeTextEl = $("#resumeText");
  const file = event.target.files?.[0];
  if (!file || !uploadStatusEl || !resumeTextEl) return;
  if (!state.user) {
    alert("Please log in first.");
    event.target.value = "";
    return;
  }

  uploadStatusEl.textContent = `Extracting text from ${file.name}...`;
  try {
    const data = await extractResumeFromUpload(file);
    resumeTextEl.value = data.extractedText || "";
    const size = (data.extractedText || "").length;
    uploadStatusEl.textContent = `Extracted ${size} characters from ${data.filename}.`;
    if (data.warning) {
      uploadStatusEl.textContent += ` ${data.warning}`;
    }
  } catch (error) {
    uploadStatusEl.textContent = error.message;
  }
}

async function analyzeResume() {
  if (!state.user) {
    alert("Please log in first.");
    return;
  }

  const scoreCard = $("#atsScoreCard");
  if (!scoreCard) return;

  try {
    const data = await apiFetch("/api/resume/analyze", {
      method: "POST",
      body: JSON.stringify({
        resumeText: $("#resumeText")?.value || "",
        jobDescText: $("#jobDescText")?.value || ""
      })
    });
    scoreCard.classList.remove("hidden");
    scoreCard.innerHTML = `
      <p class="score-headline">ATS Match Score: ${data.score}%</p>
      <p><strong>Matched keywords:</strong> ${escapeHtml((data.matchedKeywords || []).join(", ") || "None yet")}</p>
      <p><strong>Missing keywords:</strong> ${escapeHtml((data.missingKeywords || []).join(", ") || "Great coverage")}</p>
      <p><strong>Suggestions:</strong></p>
      <ul>${(data.suggestions || []).map((tip) => `<li>${escapeHtml(tip)}</li>`).join("")}</ul>
    `;
  } catch (error) {
    alert(error.message);
  }
}

async function loadSavedJobs() {
  const savedEl = $("#savedJobs");
  if (!savedEl) return;
  if (!state.user) {
    savedEl.innerHTML = `<p class="result-meta">Log in to save and manage jobs.</p>`;
    return;
  }

  try {
    const data = await apiFetch("/api/saved-jobs", { method: "GET" });
    const jobs = data.savedJobs || [];
    if (!jobs.length) {
      savedEl.innerHTML = `<p class="result-meta">No saved jobs yet.</p>`;
      return;
    }
    savedEl.innerHTML = jobs
      .map(
        (job) => `
        <article class="result-item">
          <h4>${escapeHtml(job.title)} - ${escapeHtml(job.company)}</h4>
          <p class="result-meta">${escapeHtml(job.location)} | ${escapeHtml(job.job_type)}</p>
          <div class="result-actions">
            <button class="btn ghost remove-job-btn" data-id="${job.id}">Remove</button>
            ${job.url ? `<a class="btn ghost" href="${escapeHtml(job.url)}" target="_blank" rel="noopener noreferrer">Open</a>` : ""}
          </div>
        </article>
      `
      )
      .join("");

    $$(".remove-job-btn").forEach((button) => {
      bind(button, "click", async () => {
        try {
          await apiFetch(`/api/saved-jobs/${button.dataset.id}`, { method: "DELETE" });
          await loadSavedJobs();
        } catch (error) {
          alert(error.message);
        }
      });
    });
  } catch (error) {
    savedEl.innerHTML = `<p class="result-meta">${escapeHtml(error.message)}</p>`;
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
    if ($("#trackCompany")) $("#trackCompany").value = "";
    if ($("#trackRole")) $("#trackRole").value = "";
    await loadApplications();
  } catch (error) {
    alert(error.message);
  }
}

async function loadApplications() {
  const wrap = $("#trackerTableWrap");
  if (!wrap) return;
  if (!state.user) {
    wrap.innerHTML = `<p class="result-meta">Log in to track applications.</p>`;
    return;
  }
  try {
    const data = await apiFetch("/api/applications", { method: "GET" });
    const apps = data.applications || [];
    if (!apps.length) {
      wrap.innerHTML = `<p class="result-meta">No applications tracked yet.</p>`;
      return;
    }
    wrap.innerHTML = `
      <table>
        <thead>
          <tr><th>Company</th><th>Role</th><th>Stage</th><th>Date</th><th>Action</th></tr>
        </thead>
        <tbody>
          ${apps
            .map(
              (item) => `
            <tr>
              <td>${escapeHtml(item.company)}</td>
              <td>${escapeHtml(item.role)}</td>
              <td>${escapeHtml(item.stage)}</td>
              <td>${escapeHtml(item.app_date || "-")}</td>
              <td><button class="btn ghost remove-app-btn" data-id="${item.id}">Delete</button></td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;

    $$(".remove-app-btn").forEach((button) => {
      bind(button, "click", async () => {
        try {
          await apiFetch(`/api/applications/${button.dataset.id}`, { method: "DELETE" });
          await loadApplications();
        } catch (error) {
          alert(error.message);
        }
      });
    });
  } catch (error) {
    wrap.innerHTML = `<p class="result-meta">${escapeHtml(error.message)}</p>`;
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
  const wrap = $("#analyticsWrap");
  if (!wrap) return;
  if (!state.user) {
    wrap.innerHTML = `<p class="result-meta">Please log in as admin.</p>`;
    return;
  }
  try {
    const data = await apiFetch("/api/admin/analytics", { method: "GET" });
    const a = data.analytics;
    wrap.innerHTML = `
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
    wrap.innerHTML = `<p class="result-meta">${escapeHtml(error.message)}</p>`;
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
  $$(".tier-btn").forEach((button) => bind(button, "click", () => chooseTier(button.dataset.tier)));
}

async function bootstrap() {
  initBindings();
  await loadCurrentUser();
  if ($("#findJobsBtn")) await findJobs();
  if ($("#savedJobs")) await loadSavedJobs();
  if ($("#trackerTableWrap")) await loadApplications();
}

bootstrap();
