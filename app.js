// Duty Rotator Web App Client Logic

// 1. SUPABASE CLIENT INITIALIZATION
try {
  if (typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined') {
    if (SUPABASE_URL !== "YOUR_SUPABASE_URL" && SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY") {
      if (window.supabase && typeof window.supabase.createClient === 'function') {
        window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      } else {
        console.error("Supabase CDN script was not loaded. Please check your internet connection.");
      }
    }
  }
} catch (err) {
  console.error("Failed to initialize Supabase client:", err);
}

// 1.2. FIREBASE CLIENT INITIALIZATION
try {
  if (typeof FIREBASE_CONFIG !== 'undefined' && typeof firebase !== 'undefined') {
    firebase.initializeApp(FIREBASE_CONFIG);
  } else {
    console.error("Firebase SDK or FIREBASE_CONFIG was not loaded.");
  }
} catch (err) {
  console.error("Failed to initialize Firebase client:", err);
}

// Global Application State
let session = null;
let profile = null; // User's custom profile
let activeWorkspace = 'office'; // 'office' or 'house'
let members = [];
let pairs = [];
let duties = []; // Completed and overridden duties from DB
let calendarDate = new Date(); // Track current month/year in calendar view
let calendarViewMode = 'day'; // 'day' or 'month' active view mode
let installPromptEvent = null;
let isSettingsAdminUnlocked = false;
let showSignupPin = false;

// Configurable constants
const DEFAULT_ADMIN_PIN = "1234";
const BASELINE_DATE = new Date("2026-01-01"); // Anchor for schedule sequence

// Funny Motivation Data
const FUNNY_QUOTES = {
  food: [
    "Remember: food waste doesn't walk itself out, though it might start crawling if you wait longer.",
    "Food waste duty! Go feed the dumpster before it decides to order takeout itself.",
    "The bins are crying. Go rescue them. Yes, you.",
    "Don't let the office kitchen turn into a biological research lab. Clear the food waste!",
    "Legend says if you don't clear the food waste today, the coffee machine will stop working.",
    "Trash duty: The only job where you can dump your problems and nobody complains."
  ],
  plastic: [
    "Plastic waste: It will outlive us all, but it shouldn't outlive its stay in the bin.",
    "Time to recycle! Sort that plastic like your career depends on it.",
    "Plastic duty: Go clear the bottles before they form their own union.",
    "Recycle or else. The recycling bins are watching you.",
    "Save the turtles, or at least save your reputation by taking out the plastic bin."
  ]
};

const FUNNY_WHATSAPP_TEMPLATES = [
  "TRASH CONSPIRACY! Yo {names}, the bins are plotting a rebellion. Feed the dumpster before they take over!",
  "Knock knock. Who's there? Trash. Trash who? Trash you need to take out today, {names}!",
  "Breaking News: {names} have been nominated for the Nobel Prize in Waste Management. The award ceremony is at the bins. Don't be late!",
  "Hey {names}, a legendary quest awaits: Banishing the Waste to the outer dumpster. Ready your weapons (gloves)!",
  "Yo {names}, unless you want the bins to start writing their own code, it's time to empty them!"
];

const FUNNY_VICTORIES = [
  "Waste vanquished! The workspace is safe for another 24 hours.",
  "Congratulations! You successfully avoided smelling like a garbage truck.",
  "The bins are happy, the environment is happy, everyone is happy.",
  "Cleanliness level increased! You got +100 Clean Points.",
  "Trash successfully evicted! Outstanding work."
];

// 2. INITIALIZATION ON PAGE LOAD
window.addEventListener('DOMContentLoaded', () => {
  // Register Service Worker for PWA cache & Push Notifications
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => {
        console.log('[Service Worker] Registered scope:', reg.scope);
      })
      .catch((err) => {
        console.error('[Service Worker] Registration failed:', err);
      });
  }

  initApp();
  setupEventListeners();
  setupPwaInstall();
  if (typeof lucide !== 'undefined') lucide.createIcons();
});

// Initialize session from localStorage & UI routing
async function initApp() {
  showLoading(true);

  if (!supabase) {
    showToast("Please configure your Supabase URL & Anon Key in config.js!", 6000);
    showLoading(false);
    return;
  }

  // Load session from localStorage
  const savedSession = localStorage.getItem('waste_duty_session');
  if (savedSession) {
    try {
      session = JSON.parse(savedSession);
      await fetchProfileAndRoute();
    } catch (err) {
      console.error("Failed to parse saved session:", err);
      handleLogout();
    }
  } else {
    session = null;
    profile = null;
    routeTo('view-login');
    syncPinDots('login-pin', 'login-pin-dots');
    triggerRoboReaction('login', 'default');
    document.getElementById('main-app-container').classList.add('hidden');
    showLoading(false);
  }
}

// Fetch user profile and determine views
async function fetchProfileAndRoute() {
  try {
    const { data: userProfile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!userProfile) {
      showToast("No account found. Please sign up first.");
      localStorage.removeItem('waste_duty_session');
      routeTo('view-signup');
      return;
    } else {
      profile = userProfile;
      
      // Update UI with user info
      document.getElementById('header-username').innerText = profile.name;
      document.getElementById('header-avatar').innerText = profile.name.charAt(0).toUpperCase();

      // Configure workspace access based on user selection
      if (profile.workspace_association === 'both') {
        document.getElementById('workspace-switcher').classList.remove('hidden');
        // Default to office
        setActiveWorkspace('office');
      } else {
        document.getElementById('workspace-switcher').classList.add('hidden');
        setActiveWorkspace(profile.workspace_association);
      }

      document.getElementById('main-app-container').classList.remove('hidden');
      routeTo(''); // Hides login/signup views, shows tab layouts
      
      // Load current tab data
      await loadCurrentWorkspaceData();
    }
  } catch (err) {
    console.error("Profile fetch error:", err);
    showToast("Error loading profile: " + err.message);
  } finally {
    showLoading(false);
  }
}

// Load members, pairs, and duties for the active workspace
async function loadCurrentWorkspaceData() {
  if (!supabase || !session) return;
  
  try {
    // 1. Fetch profiles (members) associated with this workspace
    const { data: dbMembers, error: memErr } = await supabase
      .from('profiles')
      .select('*')
      .or(`workspace_association.eq.both,workspace_association.eq.${activeWorkspace}`);
    
    if (memErr) throw memErr;
    members = dbMembers || [];

    // 2. Fetch pairs for this workspace
    const { data: dbPairs, error: pairErr } = await supabase
      .from('pairs')
      .select('*')
      .eq('workspace', activeWorkspace);
      
    if (pairErr) throw pairErr;
    
    // Sort pairs by creation/id to keep order deterministic or use custom ordering if saved
    pairs = dbPairs || [];

    // Self-healing / Sync logic for House Mode individual chores
    if (activeWorkspace === 'house') {
      const missingPairs = [];
      members.forEach(member => {
        const hasSinglePair = pairs.some(p => p.member1_id === member.id && !p.member2_id);
        if (!hasSinglePair) {
          missingPairs.push({
            workspace: 'house',
            member1_id: member.id,
            member2_id: null
          });
        }
      });
      
      if (missingPairs.length > 0) {
        const { data: insertedPairs, error: insertErr } = await supabase
          .from('pairs')
          .insert(missingPairs)
          .select();
        
        if (insertErr) {
          console.error("Error inserting single-member pairs:", insertErr);
        } else if (insertedPairs) {
          pairs.push(...insertedPairs);
        }
      }
      
      // Filter out any multi-member pairs that might exist in House Mode
      pairs = pairs.filter(p => !p.member2_id);
    }
    
    // 3. Fetch completed or overridden duties for this workspace (limit to recent and upcoming)
    const { data: dbDuties, error: dutyErr } = await supabase
      .from('duties')
      .select('*')
      .eq('workspace', activeWorkspace);
      
    if (dutyErr) throw dutyErr;
    duties = dbDuties || [];

    // 4. Update UI
    updateDashboardView();
    updateCalendarView();
    updateSettingsView();
    
  } catch (err) {
    console.error("Data loading error:", err);
    showToast("Error syncing data: " + err.message);
  }
}

// Set active workspace (office vs house) and swap themes
function setActiveWorkspace(workspace) {
  activeWorkspace = workspace;
  
  const body = document.body;
  if (workspace === 'office') {
    body.className = 'dark-theme office-theme';
    document.getElementById('header-user-role').innerText = 'Office Mode';
    document.getElementById('switch-btn-office').classList.add('active');
    document.getElementById('switch-btn-house').classList.remove('active');
  } else {
    body.className = 'dark-theme house-theme';
    document.getElementById('header-user-role').innerText = 'House Mode';
    document.getElementById('switch-btn-office').classList.remove('active');
    document.getElementById('switch-btn-house').classList.add('active');
  }
  
  // Re-render UI
  loadCurrentWorkspaceData();
}

// 3. SCHEDULER LOGIC (SHUFFLE AND CYCLE)
// Helper to check if a Date is an active duty day (Mon, Wed, Thu, Fri)
function getDutyTypeForDate(date) {
  const day = date.getDay(); // 0: Sun, 1: Mon, 2: Tue, 3: Wed, 4: Thu, 5: Fri, 6: Sat
  if (day === 1 || day === 3 || day === 5) {
    return 'food'; // Monday, Wednesday, Friday
  } else if (day === 4) {
    return 'plastic'; // Thursday
  }
  return null; // None
}

// Deterministic counter of duty days from baseline to targetDate
function getDutyDayIndex(targetDate) {
  let count = 0;
  let current = new Date(BASELINE_DATE.getTime());
  
  // Normalize time
  current.setHours(0,0,0,0);
  const target = new Date(targetDate.getTime());
  target.setHours(0,0,0,0);

  if (target < current) return 0;

  while (current <= target) {
    if (getDutyTypeForDate(current) !== null) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
}

// Resolve who has duty on a date
function resolveDutyForDate(date) {
  const dateStr = formatDateToYYYYMMDD(date);
  const dutyType = getDutyTypeForDate(date);
  
  if (!dutyType) return null;

  // 1. Check if we have a locked record in the duties list (completed or overridden)
  const savedRecord = duties.find(d => d.date === dateStr && d.duty_type === dutyType);
  
  if (savedRecord) {
    let pairNames = "Unassigned";
    let isOverride = false;
    
    // Find pair details
    const activePairId = savedRecord.override_pair_id || savedRecord.pair_id;
    const pair = pairs.find(p => p.id === activePairId);
    
    if (savedRecord.completed && savedRecord.completed_by_names) {
      pairNames = savedRecord.completed_by_names;
    } else if (pair) {
      pairNames = getPairMemberNames(pair);
    }
    
    return {
      id: savedRecord.id,
      date: dateStr,
      duty_type: dutyType,
      pair_id: activePairId,
      pair_names: pairNames,
      completed: savedRecord.completed,
      is_override: !!savedRecord.override_pair_id,
      record: savedRecord
    };
  }

  // 2. Dynamic generation (Fallback to deterministic cycle)
  if (pairs.length === 0) {
    return {
      date: dateStr,
      duty_type: dutyType,
      pair_id: null,
      pair_names: "No Pairs Created",
      completed: false,
      is_override: false
    };
  }

  const dutyIndex = getDutyDayIndex(date);
  // Sort pairs by ID or rotation order to ensure all devices cycle in exact same sequence
  const sortedPairs = [...pairs].sort((a,b) => a.id.localeCompare(b.id));
  const assignedPair = sortedPairs[dutyIndex % sortedPairs.length];

  return {
    date: dateStr,
    duty_type: dutyType,
    pair_id: assignedPair.id,
    pair_names: getPairMemberNames(assignedPair),
    completed: false,
    is_override: false
  };
}

// Helper to get text display of pair members
function getPairMemberNames(pair) {
  const mem1 = members.find(m => m.id === pair.member1_id);
  const name1 = mem1 ? mem1.name : "Deleted User";
  
  if (!pair.member2_id) {
    return name1;
  }
  
  const mem2 = members.find(m => m.id === pair.member2_id);
  const name2 = mem2 ? mem2.name : "Deleted User";
  
  return `${name1} & ${name2}`;
}

// 4. RENDERING VIEWS

// Update the main Dashboard Tab
function updateDashboardView() {
  const today = new Date();
  const duty = resolveDutyForDate(today);

  const container = document.getElementById('today-duty-card');
  const badge = document.getElementById('today-duty-badge');
  const namesEl = document.getElementById('today-duty-names');
  const dateEl = document.getElementById('today-duty-date');
  const quoteEl = document.getElementById('dashboard-funny-quote');
  const victoryEl = document.getElementById('today-victory-banner');
  const btnComplete = document.getElementById('btn-complete-duty');
  const btnCompleteText = document.getElementById('complete-btn-text');

  // Format today's date readable
  const options = { weekday: 'long', month: 'short', day: 'numeric' };
  dateEl.innerText = today.toLocaleDateString('en-US', options);

  if (!duty) {
    // No duty today (Tuesday or weekend)
    badge.innerText = "Rest Day";
    badge.style.backgroundColor = "rgba(142, 142, 147, 0.12)";
    badge.style.color = "#8E8E93";
    namesEl.innerText = "No duties scheduled today!";
    btnComplete.classList.add('hidden');
    btnCompleteText.classList.add('hidden');
    victoryEl.classList.add('hidden');
    document.getElementById('btn-whatsapp-reminder').classList.add('hidden');
    quoteEl.innerText = "Rest up! The waste piles wait for tomorrow.";
    return;
  }

  // Active duty styling
  btnComplete.classList.remove('hidden');
  btnCompleteText.classList.remove('hidden');
  document.getElementById('btn-whatsapp-reminder').classList.remove('hidden');
  
  // Set badge and themes
  badge.innerText = duty.duty_type === 'food' ? "Food Waste" : "Plastic Waste";
  if (duty.duty_type === 'food') {
    badge.style.backgroundColor = "rgba(48, 209, 88, 0.15)";
    badge.style.color = "#30D158";
  } else {
    badge.style.backgroundColor = "rgba(10, 132, 255, 0.15)";
    badge.style.color = "#0A84FF";
  }

  namesEl.innerText = duty.pair_names;
  
  const labelEl = container.querySelector('.duty-info h3');
  if (labelEl) {
    labelEl.innerText = activeWorkspace === 'house' ? "Responsible Member:" : "Responsible Pair:";
  }

  // Display completed state
  if (duty.completed) {
    container.classList.add('completed');
    btnCompleteText.innerText = "Completed!";
    victoryEl.classList.remove('hidden');
    
    // Choose a static funny victory quote or index it
    const vText = FUNNY_VICTORIES[getDutyDayIndex(today) % FUNNY_VICTORIES.length];
    document.getElementById('victory-text').innerText = vText;
  } else {
    container.classList.remove('completed');
    btnCompleteText.innerText = "Tap to Complete";
    victoryEl.classList.add('hidden');
  }

  // Load funny motivation quote
  const quotes = FUNNY_QUOTES[duty.duty_type];
  const quoteIndex = getDutyDayIndex(today) % quotes.length;
  quoteEl.innerText = `"${quotes[quoteIndex]}"`;

  // Render Tomorrow's Preview
  renderTomorrowPreview();
}

function renderTomorrowPreview() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextDuty = resolveDutyForDate(tomorrow);

  const tCard = document.getElementById('tomorrow-duty-card');
  const tBadge = document.getElementById('tomorrow-duty-badge');
  const tNames = tCard.querySelector('h4');
  const tDate = tCard.querySelector('p');

  const options = { weekday: 'short', month: 'short', day: 'numeric' };
  tDate.innerText = tomorrow.toLocaleDateString('en-US', options);

  if (!nextDuty) {
    tCard.classList.add('hidden');
  } else {
    tCard.classList.remove('hidden');
    tNames.innerText = nextDuty.pair_names;
    tBadge.innerText = nextDuty.duty_type === 'food' ? "Food Waste" : "Plastic Waste";
    tBadge.className = `next-badge ${nextDuty.duty_type}`;
  }
}

// Update the Calendar View Grid
function updateCalendarView() {
  if (calendarViewMode === 'day') {
    renderCalendarDayView();
    return;
  }

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();

  // Update Month/Year Header
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  document.getElementById('calendar-month-title').innerText = `${monthNames[month]} ${year}`;

  const container = document.getElementById('calendar-days-container');
  container.innerHTML = "";

  // Get calendar details
  const firstDayIndex = new Date(year, month, 1).getDay(); // Sun: 0, Mon: 1...
  // Shift index so Monday is 0
  const adjustedStartDay = firstDayIndex === 0 ? 6 : firstDayIndex - 1;
  const totalDays = new Date(year, month + 1, 0).getDate();

  // Render blank empty days for offsets
  for (let i = 0; i < adjustedStartDay; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = "calendar-day-box empty";
    container.appendChild(emptyCell);
  }

  // Render actual calendar days
  const todayStr = formatDateToYYYYMMDD(new Date());
  
  for (let day = 1; day <= totalDays; day++) {
    const currentDayDate = new Date(year, month, day);
    const dateStr = formatDateToYYYYMMDD(currentDayDate);
    const duty = resolveDutyForDate(currentDayDate);

    const cell = document.createElement('div');
    cell.className = "calendar-day-box";
    if (dateStr === todayStr) {
      cell.classList.add('today');
    }

    cell.innerHTML = `<span class="day-number">${day}</span>`;

    if (duty) {
      cell.classList.add('active-duty-day');
      if (duty.completed) {
        cell.classList.add('completed');
        cell.innerHTML += `<div class="cal-checked-icon"></div>`;
      }
      
      // Color bar indicator
      const bar = document.createElement('div');
      bar.className = `cal-duty-indicator ${duty.duty_type}`;
      cell.appendChild(bar);

      // Short name labels
      const namesEl = document.createElement('span');
      namesEl.className = "cal-day-names";
      namesEl.innerText = duty.pair_names;
      cell.appendChild(namesEl);
    }

    // In Month view, clicking any day cell sets calendarDate and zooms into Day View!
    cell.addEventListener('click', () => {
      calendarDate = currentDayDate;
      setCalendarViewMode('day');
    });

    container.appendChild(cell);
  }
  
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Render single day details in calendar Day View
function renderCalendarDayView() {
  const options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
  document.getElementById('day-focus-date').innerText = calendarDate.toLocaleDateString('en-US', options);

  const duty = resolveDutyForDate(calendarDate);
  const badge = document.getElementById('day-focus-badge');
  const names = document.getElementById('day-focus-names');
  const status = document.getElementById('day-focus-status');
  const card = document.getElementById('day-focus-card');

  // Reset classes
  status.className = "day-focus-status";
  
  if (!duty) {
    badge.innerText = "Rest Day";
    badge.style.backgroundColor = "rgba(142, 142, 147, 0.12)";
    badge.style.color = "#8E8E93";
    names.innerText = "No Chores Scheduled";
    status.innerText = "Enjoy the day off!";
    card.onclick = null;
    card.style.cursor = "default";
  } else {
    badge.innerText = duty.duty_type === 'food' ? "Food Waste" : "Plastic Waste";
    if (duty.duty_type === 'food') {
      badge.style.backgroundColor = "rgba(48, 209, 88, 0.15)";
      badge.style.color = "#30D158";
    } else {
      badge.style.backgroundColor = "rgba(10, 132, 255, 0.15)";
      badge.style.color = "#0A84FF";
    }

    names.innerText = duty.pair_names;
    
    if (duty.completed) {
      status.innerText = "Completed";
      status.classList.add('completed');
    } else {
      status.innerText = "Status: Pending";
    }

    // Clicking the day card opens the override/swap modal
    card.onclick = () => {
      openOverrideModal(calendarDate, duty);
    };
    card.style.cursor = "pointer";
  }
}

// Set calendar view mode (day vs month) with transition animations
function setCalendarViewMode(mode) {
  if (calendarViewMode === mode) return;
  
  const dayContainer = document.getElementById('calendar-day-view-container');
  const monthContainer = document.getElementById('calendar-month-view-container');
  const btnDay = document.getElementById('btn-calendar-day-mode');
  const btnMonth = document.getElementById('btn-calendar-month-mode');

  calendarViewMode = mode;
  
  if (mode === 'day') {
    btnDay.classList.add('active');
    btnMonth.classList.remove('active');

    // Trigger Zoom In Animation
    monthContainer.classList.add('hidden');
    dayContainer.classList.remove('hidden');
    dayContainer.classList.remove('zoom-out-active');
    dayContainer.classList.add('zoom-in-active');
    
    setTimeout(() => {
      dayContainer.classList.remove('zoom-in-active');
    }, 350);

  } else {
    btnDay.classList.remove('active');
    btnMonth.classList.add('active');

    // Trigger Zoom Out Animation
    dayContainer.classList.add('hidden');
    monthContainer.classList.remove('hidden');
    monthContainer.classList.remove('zoom-in-active');
    monthContainer.classList.add('zoom-out-active');

    setTimeout(() => {
      monthContainer.classList.remove('zoom-out-active');
    }, 350);
  }

  // Refresh view content
  updateCalendarView();
}

// Pinch gesture detection state
let touchStartDistance = 0;
let isPinchGesture = false;

function setupPinchGestures(element) {
  element.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      touchStartDistance = getDistanceBetweenTouches(e.touches[0], e.touches[1]);
      isPinchGesture = true;
    }
  });

  element.addEventListener('touchmove', (e) => {
    if (isPinchGesture && e.touches.length === 2) {
      const currentDistance = getDistanceBetweenTouches(e.touches[0], e.touches[1]);
      const factor = currentDistance / touchStartDistance;
      
      // Pinch out (fingers spread apart -> Zoom In -> Day View)
      // Pinch in (fingers coming closer -> Zoom Out -> Month View)
      if (factor < 0.75) {
        setCalendarViewMode('month');
        isPinchGesture = false; // Trigger once
      } else if (factor > 1.35) {
        setCalendarViewMode('day');
        isPinchGesture = false;
      }
    }
  });

  element.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
      isPinchGesture = false;
    }
  });
}

function getDistanceBetweenTouches(t1, t2) {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// Update the Settings Tab View
function updateSettingsView() {
  // Update Lock screen status
  const lockScreen = document.getElementById('settings-admin-lock');
  const panel = document.getElementById('settings-admin-panel');
  
  if (isSettingsAdminUnlocked || (profile && profile.is_admin)) {
    lockScreen.classList.add('hidden');
    panel.classList.remove('hidden');
    
    // Hide/show pairs section depending on workspace mode
    const pairsSection = document.getElementById('settings-section-pairs');
    if (pairsSection) {
      if (activeWorkspace === 'house') {
        pairsSection.classList.add('hidden');
      } else {
        pairsSection.classList.remove('hidden');
      }
    }
    
    // Render detailed management lists
    renderMembersList();
    renderPairsList();
    renderRotationList();
  } else {
    lockScreen.classList.remove('hidden');
    panel.classList.add('hidden');
  }

  // Initialize push notification toggle status
  initPushNotificationToggle();
}

// Render members details in settings
function renderMembersList() {
  const container = document.getElementById('settings-members-list');
  container.innerHTML = "";
  
  members.forEach(member => {
    const item = document.createElement('div');
    item.className = "member-item";
    item.innerHTML = `
      <div class="member-details">
        <h4>${member.name} ${member.is_admin ? '<small class="workspace-indicator">(Admin)</small>' : ''}</h4>
        <span>${member.phone}</span>
      </div>
      ${member.id !== session.user.id ? `
        <button class="icon-btn-plain text-danger" onclick="deleteMember('${member.id}')">
          <i data-lucide="trash-2"></i>
        </button>
      ` : ''}
    `;
    container.appendChild(item);
  });
  
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Render pairs list in settings
function renderPairsList() {
  const container = document.getElementById('settings-pairs-list');
  container.innerHTML = "";

  pairs.forEach(pair => {
    const item = document.createElement('div');
    item.className = "pair-item";
    item.innerHTML = `
      <div class="pair-info">
        <i data-lucide="users"></i>
        <span>${getPairMemberNames(pair)}</span>
      </div>
      <button class="icon-btn-plain text-danger" onclick="deletePair('${pair.id}')">
        <i data-lucide="trash-2"></i>
      </button>
    `;
    container.appendChild(item);
  });

  // Re-populate member selects in Create Pair sub-form
  const sel1 = document.getElementById('pair-member-1');
  const sel2 = document.getElementById('pair-member-2');
  
  sel1.innerHTML = `<option value="">Choose Member...</option>`;
  sel2.innerHTML = `<option value="">Choose Member...</option>`;
  
  members.forEach(m => {
    sel1.innerHTML += `<option value="${m.id}">${m.name}</option>`;
    sel2.innerHTML += `<option value="${m.id}">${m.name}</option>`;
  });
  
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Render rotation order list
function renderRotationList() {
  const container = document.getElementById('settings-rotation-list');
  container.innerHTML = "";

  // Dynamic sorting
  const sortedPairs = [...pairs].sort((a,b) => a.id.localeCompare(b.id));
  
  if (sortedPairs.length === 0) {
    container.innerHTML = `<p class="section-desc">Create some pairs to view the rotation cycle.</p>`;
    return;
  }

  sortedPairs.forEach((pair, index) => {
    const item = document.createElement('div');
    item.className = "rotation-queue-item";
    item.innerHTML = `
      <span class="queue-index">${index + 1}</span>
      <span class="queue-names">${getPairMemberNames(pair)}</span>
    `;
    container.appendChild(item);
  });
}

// 5. EVENT LISTENERS SETUP
function setupEventListeners() {
  // A. LOGIN AUTH ACTIONS
  // A. LOGIN AUTH ACTIONS
  const btnLoginSubmit = document.getElementById('btn-login-submit');
  btnLoginSubmit.addEventListener('click', handleLogin);
  btnLoginSubmit.addEventListener('mouseenter', () => triggerRoboReaction('login', 'submit'));
  btnLoginSubmit.addEventListener('mouseleave', () => triggerRoboReaction('login', 'default'));
  btnLoginSubmit.addEventListener('focus', () => triggerRoboReaction('login', 'submit'));
  btnLoginSubmit.addEventListener('blur', () => triggerRoboReaction('login', 'default'));

  const loginPhone = document.getElementById('login-phone');
  if (loginPhone) {
    loginPhone.addEventListener('focus', function() { triggerRoboReaction('login', 'phone', this.value); });
    loginPhone.addEventListener('input', function() { triggerRoboReaction('login', 'phone', this.value); });
    loginPhone.addEventListener('blur', () => triggerRoboReaction('login', 'default'));
  }

  const loginPin = document.getElementById('login-pin');
  if (loginPin) {
    loginPin.addEventListener('input', () => {
      syncPinDots('login-pin', 'login-pin-dots');
      triggerRoboReaction('login', 'pin');
    });
    loginPin.addEventListener('focus', () => {
      syncPinDots('login-pin', 'login-pin-dots');
      triggerRoboReaction('login', 'pin');
    });
    loginPin.addEventListener('blur', () => {
      syncPinDots('login-pin', 'login-pin-dots');
      triggerRoboReaction('login', 'default');
    });
    
    const wrapper = document.getElementById('login-pin-dots').parentElement;
    wrapper.addEventListener('click', () => loginPin.focus());
  }

  // A2. SIGNUP AUTH ACTIONS
  const btnSignupSubmit = document.getElementById('btn-signup-submit');
  btnSignupSubmit.addEventListener('click', handleSignup);
  btnSignupSubmit.addEventListener('mouseenter', () => triggerRoboReaction('signup', 'submit'));
  btnSignupSubmit.addEventListener('mouseleave', () => triggerRoboReaction('signup', 'default'));
  btnSignupSubmit.addEventListener('focus', () => triggerRoboReaction('signup', 'submit'));
  btnSignupSubmit.addEventListener('blur', () => triggerRoboReaction('signup', 'default'));
  
  const signupName = document.getElementById('signup-name');
  if (signupName) {
    signupName.addEventListener('focus', function() { triggerRoboReaction('signup', 'name', this.value); });
    signupName.addEventListener('input', function() { triggerRoboReaction('signup', 'name', this.value); });
    signupName.addEventListener('blur', () => triggerRoboReaction('signup', 'default'));
  }

  const signupPhone = document.getElementById('signup-phone');
  if (signupPhone) {
    signupPhone.addEventListener('focus', function() { triggerRoboReaction('signup', 'phone', this.value); });
    signupPhone.addEventListener('input', function() { triggerRoboReaction('signup', 'phone', this.value); });
    signupPhone.addEventListener('blur', () => triggerRoboReaction('signup', 'default'));
  }

  const signupPin = document.getElementById('signup-pin');
  if (signupPin) {
    signupPin.addEventListener('input', () => {
      syncPinDots('signup-pin', 'signup-pin-dots', showSignupPin);
      triggerRoboReaction('signup', 'pin');
    });
    signupPin.addEventListener('focus', () => {
      syncPinDots('signup-pin', 'signup-pin-dots', showSignupPin);
      triggerRoboReaction('signup', 'pin');
    });
    signupPin.addEventListener('blur', () => {
      syncPinDots('signup-pin', 'signup-pin-dots', showSignupPin);
      triggerRoboReaction('signup', 'default');
    });
    
    const wrapper = document.getElementById('signup-pin-dots').parentElement;
    wrapper.addEventListener('click', (e) => {
      if (!e.target.closest('#btn-toggle-signup-pin')) {
        signupPin.focus();
      }
    });

    const btnToggleSignupPin = document.getElementById('btn-toggle-signup-pin');
    if (btnToggleSignupPin) {
      btnToggleSignupPin.addEventListener('click', (e) => {
        e.stopPropagation();
        showSignupPin = !showSignupPin;
        signupPin.type = showSignupPin ? 'text' : 'password';
        
        const icon = btnToggleSignupPin.querySelector('i, svg');
        if (icon && typeof lucide !== 'undefined') {
          icon.setAttribute('data-lucide', showSignupPin ? 'eye-off' : 'eye');
          lucide.createIcons();
        }
        
        syncPinDots('signup-pin', 'signup-pin-dots', showSignupPin);
      });
    }
  }

  // Workspace radio listeners
  document.querySelectorAll('input[name="signup-workspace"]').forEach(radio => {
    radio.addEventListener('change', function() {
      if (this.checked) {
        triggerRoboReaction('signup', 'workspace', this.value);
      }
    });
  });

  // A3. LOGIN <-> SIGNUP TOGGLE
  document.getElementById('btn-goto-signup').addEventListener('click', () => {
    document.getElementById('form-login').reset();
    syncPinDots('login-pin', 'login-pin-dots');
    showSignupPin = false;
    if (signupPin) signupPin.type = 'password';
    const icon = document.querySelector('#btn-toggle-signup-pin i, #btn-toggle-signup-pin svg');
    if (icon) icon.setAttribute('data-lucide', 'eye');
    routeTo('view-signup');
    triggerRoboReaction('signup', 'default');
    setTimeout(() => {
      syncPinDots('signup-pin', 'signup-pin-dots', showSignupPin);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }, 50);
  });
  document.getElementById('btn-goto-login').addEventListener('click', () => {
    document.getElementById('form-signup').reset();
    syncPinDots('signup-pin', 'signup-pin-dots', showSignupPin);
    routeTo('view-login');
    triggerRoboReaction('login', 'default');
    setTimeout(() => syncPinDots('login-pin', 'login-pin-dots'), 50);
  });

  document.getElementById('btn-logout').addEventListener('click', handleLogout);

  // B. WORKSPACE ACTIONS
  document.getElementById('switch-btn-office').addEventListener('click', () => {
    if (activeWorkspace !== 'office') setActiveWorkspace('office');
  });
  document.getElementById('switch-btn-house').addEventListener('click', () => {
    if (activeWorkspace !== 'house') setActiveWorkspace('house');
  });

  // C. TAB NAVIGATION
  const navItems = document.querySelectorAll('.bottom-tab-bar .tab-bar-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(x => x.classList.remove('active'));
      item.classList.add('active');
      
      const tabName = item.getAttribute('data-tab');
      document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
      document.getElementById(`view-${tabName}`).classList.add('active');
      
      // Load freshest data on click
      loadCurrentWorkspaceData();
    });
  });

  // D. DUTY COMPLETE BUTTON
  document.getElementById('btn-complete-duty').addEventListener('click', handleCompleteDuty);

  // K. PUSH NOTIFICATIONS TOGGLE
  const togglePush = document.getElementById('toggle-push-notifications');
  if (togglePush) {
    togglePush.addEventListener('change', handlePushToggleChange);
  }

  // E. WHATSAPP REMINDER
  document.getElementById('btn-whatsapp-reminder').addEventListener('click', handleWhatsappReminder);

  // F. CALENDAR NAVIGATORS & VIEW MODES
  document.getElementById('btn-prev-month').addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    updateCalendarView();
  });
  document.getElementById('btn-next-month').addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    updateCalendarView();
  });

  document.getElementById('btn-prev-day').addEventListener('click', () => {
    calendarDate.setDate(calendarDate.getDate() - 1);
    updateCalendarView();
  });
  document.getElementById('btn-next-day').addEventListener('click', () => {
    calendarDate.setDate(calendarDate.getDate() + 1);
    updateCalendarView();
  });

  document.getElementById('btn-calendar-day-mode').addEventListener('click', () => {
    setCalendarViewMode('day');
  });
  document.getElementById('btn-calendar-month-mode').addEventListener('click', () => {
    setCalendarViewMode('month');
  });

  const calendarTab = document.getElementById('view-calendar');
  if (calendarTab) {
    setupPinchGestures(calendarTab);
  }

  // G. SETTINGS UNLOCK
  document.getElementById('btn-unlock-settings').addEventListener('click', handleUnlockSettings);

  // H. ADMIN DRAWER ACCORDIONS
  document.getElementById('btn-show-add-member').addEventListener('click', () => {
    toggleDrawer('add-member-form-box');
  });
  document.getElementById('btn-cancel-member').addEventListener('click', () => {
    toggleDrawer('add-member-form-box', false);
  });
  document.getElementById('btn-save-member').addEventListener('click', handleAddMember);

  document.getElementById('btn-show-add-pair').addEventListener('click', () => {
    toggleDrawer('add-pair-form-box');
  });
  document.getElementById('btn-cancel-pair').addEventListener('click', () => {
    toggleDrawer('add-pair-form-box', false);
  });
  document.getElementById('btn-save-pair').addEventListener('click', handleAddPair);

  // I. OVERRIDE SWAP MODAL
  document.getElementById('btn-close-override').addEventListener('click', closeOverrideModal);
  document.getElementById('btn-cancel-override').addEventListener('click', closeOverrideModal);
  document.getElementById('btn-save-override').addEventListener('click', handleSaveOverride);

  // J. ACCOUNT DELETION
  document.getElementById('btn-delete-account').addEventListener('click', () => {
    document.getElementById('modal-delete-confirm').classList.remove('hidden');
  });
  document.getElementById('btn-cancel-delete').addEventListener('click', () => {
    document.getElementById('modal-delete-confirm').classList.add('hidden');
  });
  document.getElementById('btn-confirm-delete').addEventListener('click', handleDeleteAccount);
}

// 6. ACTION HANDLERS

// Phone Login - Request OTP
// Submit credentials for login
async function handleLogin() {
  const rawPhone = document.getElementById('login-phone').value.trim();
  const pin = document.getElementById('login-pin').value.trim();

  if (!rawPhone || !pin) {
    showToast("Please enter both mobile number and PIN.");
    return;
  }
  if (pin.length !== 6) {
    showToast("PIN must be exactly 6 digits.");
    return;
  }

  const phone = '+91' + rawPhone.replace(/^\+91/, '');

  showLoading(true);
  try {
    const { data: userProfile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('phone', phone)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error("Mobile number is not registered. Please sign up first.");
      }
      throw error;
    }

    if (userProfile.pin_code !== pin) {
      throw new Error("Incorrect 6-digit PIN code.");
    }

    // Success! Set session
    session = {
      user: {
        id: userProfile.id,
        phone: userProfile.phone
      }
    };

    localStorage.setItem('waste_duty_session', JSON.stringify(session));
    showToast("Welcome back, " + userProfile.name + "!");
    await fetchProfileAndRoute();
  } catch (err) {
    console.error("Login error:", err);
    showToast(err.message);
    triggerRoboReaction('login', 'error', err.message);
    showLoading(false);
  }
}

// Submit credentials for signup
async function handleSignup() {
  const name = document.getElementById('signup-name').value.trim();
  const rawPhone = document.getElementById('signup-phone').value.trim();
  const pin = document.getElementById('signup-pin').value.trim();
  const workspace = document.querySelector('input[name="signup-workspace"]:checked').value;

  if (!name) {
    showToast("Please enter your name.");
    return;
  }
  if (!rawPhone) {
    showToast("Please enter your mobile number.");
    return;
  }
  if (!pin || pin.length !== 6) {
    showToast("PIN must be exactly 6 digits.");
    return;
  }

  const phone = '+91' + rawPhone.replace(/^\+91/, '');

  showLoading(true);
  try {
    // 1. Check if user already exists
    const { data: existing, error: findErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('phone', phone)
      .single();

    if (findErr && findErr.code !== 'PGRST116') throw findErr;

    if (existing) {
      if (existing.pin_code) {
        // Already fully registered with a PIN
        throw new Error("This mobile number is already registered.");
      } else {
        // Pre-registered by admin, but no PIN set yet -> Update it!
        const { error: updErr } = await supabase
          .from('profiles')
          .update({
            name: name,
            pin_code: pin,
            workspace_association: workspace
          })
          .eq('id', existing.id);

        if (updErr) throw updErr;

        session = {
          user: {
            id: existing.id,
            phone: phone
          }
        };

        localStorage.setItem('waste_duty_session', JSON.stringify(session));
        showToast("Welcome aboard, " + name + "!");
        await fetchProfileAndRoute();
        return;
      }
    }

    // 2. Determine if first user (makes them admin)
    const { data: currentProfiles, error: countErr } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);

    if (countErr) throw countErr;
    const isFirstUser = !currentProfiles || currentProfiles.length === 0;

    // 3. Create profile row
    const newProfileId = crypto.randomUUID();
    const newProfile = {
      id: newProfileId,
      name: name,
      phone: phone,
      pin_code: pin,
      workspace_association: workspace,
      is_admin: isFirstUser
    };

    const { error: insErr } = await supabase
      .from('profiles')
      .insert(newProfile);

    if (insErr) throw insErr;

    // 4. Save session
    session = {
      user: {
        id: newProfileId,
        phone: phone
      }
    };

    localStorage.setItem('waste_duty_session', JSON.stringify(session));
    showToast(isFirstUser ? "Account created! You are the Administrator." : "Registration successful!");
    await fetchProfileAndRoute();
  } catch (err) {
    console.error("Signup error:", err);
    showToast(err.message);
    triggerRoboReaction('signup', 'error', err.message);
    showLoading(false);
  }
}

// Log out and clear session
async function handleLogout() {
  showLoading(true);
  try {
    session = null;
    profile = null;
    localStorage.removeItem('waste_duty_session');
    
    // Reset view visibility
    document.getElementById('main-app-container').classList.add('hidden');
    document.getElementById('form-login').reset();
    routeTo('view-login');
    syncPinDots('login-pin', 'login-pin-dots');
    showToast("Logged out successfully.");
  } catch (err) {
    console.error("Logout error:", err);
    showToast("Failed to logout: " + err.message);
  } finally {
    showLoading(false);
  }
}
// Helper to synchronize PIN dots UI
function syncPinDots(inputId, containerId, reveal = false) {
  const input = document.getElementById(inputId);
  const container = document.getElementById(containerId);
  if (!input || !container) return;

  const dots = container.querySelectorAll('.pin-dot');
  const val = input.value;
  const isFocused = document.activeElement === input;

  dots.forEach((dot, index) => {
    if (index < val.length) {
      if (reveal) {
        dot.className = 'pin-dot filled-text';
        dot.innerText = val[index];
      } else {
        dot.className = 'pin-dot filled';
        dot.innerText = '';
      }
    } else if (index === val.length && isFocused) {
      dot.className = 'pin-dot active';
      dot.innerText = '';
    } else {
      dot.className = 'pin-dot';
      dot.innerText = '';
    }
  });
}

// Function to update the robot speech bubble and face expression
function triggerRoboReaction(mode, type, detail = "") {
  const roboContainer = document.getElementById(`${mode}-robo`);
  const bubble = document.getElementById(`${mode}-robo-bubble`);
  const textEl = document.getElementById(`${mode}-robo-text`);
  if (!roboContainer || !bubble || !textEl) return;

  let message = "";
  let isHappy = false;
  let isShy = false;
  let isSad = false;

  switch (type) {
    case 'name':
      if (!detail) {
        message = "What should I call you?";
        isHappy = false;
      } else {
        message = `Nice name, ${detail}!`;
        isHappy = true;
      }
      break;
    case 'phone':
      if (!detail) {
        message = "Beep! Enter your mobile digits.";
      } else {
        message = "Got it! Keep typing.";
        isHappy = true;
      }
      break;
    case 'pin':
      message = mode === 'login' 
        ? "Shhh... enter your secret 6-digit PIN!"
        : "Shhh... create a secret 6-digit PIN!";
      isShy = true;
      break;
    case 'workspace':
      if (detail === 'office') {
        message = "Ready to rule the office!";
      } else if (detail === 'house') {
        message = "Let's keep the home clean!";
      } else {
        message = "Double spaces! Power worker!";
      }
      isHappy = true;
      break;
    case 'submit':
      message = "Tap to launch! Let's go!";
      isHappy = true;
      break;
    case 'error':
      message = detail || "Beep boop! You missed something.";
      isSad = true;
      break;
    default:
      message = mode === 'login' 
        ? "Beep boop. Enter your PIN code, fellow human."
        : "Hello there! Let's get you set up in a blink.";
      break;
  }

  // Display speech bubble
  textEl.innerText = message;
  bubble.classList.add('visible');

  // Trigger happy animation states
  if (isHappy) {
    roboContainer.classList.add('happy');
  } else {
    roboContainer.classList.remove('happy');
  }

  // Trigger shy eye-covering animation states
  if (isShy) {
    roboContainer.classList.add('shy');
  } else {
    roboContainer.classList.remove('shy');
  }

  // Trigger sad error animation states
  if (isSad) {
    roboContainer.classList.add('sad');
  } else {
    roboContainer.classList.remove('sad');
  }

  // Bubble stays visible with the default/welcome message
}

// Toggle Complete Duty status
async function handleCompleteDuty() {
  const today = new Date();
  const duty = resolveDutyForDate(today);
  
  if (!duty || !supabase) return;
  
  showLoading(true);
  try {
    const newCompletedState = !duty.completed;
    
    if (duty.id) {
      // Record already exists in DB, update it
      const { error } = await supabase
        .from('duties')
        .update({
          completed: newCompletedState,
          completed_by: newCompletedState ? session.user.id : null,
          completed_by_names: newCompletedState ? duty.pair_names : null
        })
        .eq('id', duty.id);
        
      if (error) throw error;
    } else {
      // Record doesn't exist, insert new
      const { error } = await supabase
        .from('duties')
        .insert({
          workspace: activeWorkspace,
          date: duty.date,
          duty_type: duty.duty_type,
          pair_id: duty.pair_id,
          completed: newCompletedState,
          completed_by: newCompletedState ? session.user.id : null,
          completed_by_names: newCompletedState ? duty.pair_names : null
        });
        
      if (error) throw error;
    }
    
    if (newCompletedState) {
      // Trigger canvas confetti celebration!
      confetti({
        particleCount: 120,
        spread: 70,
        origin: { y: 0.85 }
      });
      showToast("Duty completed! You are awesome!");
    } else {
      showToast("Duty state reset.");
    }
    
    // Refresh
    await loadCurrentWorkspaceData();
  } catch (err) {
    console.error("Completion update error:", err);
    showToast("Error updating status: " + err.message);
  } finally {
    showLoading(false);
  }
}

// Send WhatsApp Reminder
function handleWhatsappReminder() {
  const today = new Date();
  const duty = resolveDutyForDate(today);
  if (!duty) return;

  // Extract phone numbers of the pair
  const savedRecord = duties.find(d => d.date === duty.date && d.duty_type === duty.duty_type);
  const activePairId = (savedRecord && (savedRecord.override_pair_id || savedRecord.pair_id)) || duty.pair_id;
  const pair = pairs.find(p => p.id === activePairId);

  if (!pair) {
    showToast("No active pair found to remind.");
    return;
  }

  const mem1 = members.find(m => m.id === pair.member1_id);
  const mem2 = members.find(m => m.id === pair.member2_id);

  if (!mem1 && !mem2) {
    showToast("Members not found.");
    return;
  }

  // Precomposed funny WhatsApp link templates
  const namesStr = getPairMemberNames(pair);
  const randomTemplate = FUNNY_WHATSAPP_TEMPLATES[getDutyDayIndex(today) % FUNNY_WHATSAPP_TEMPLATES.length];
  const textMsg = encodeURIComponent(randomTemplate.replace('{names}', namesStr));

  // Determine which phone number to send to. If clicking triggers, we can send to a WhatsApp group, 
  // or open a chat with Member 1. 
  // Since we are sending from phone, wa.me opens a chat with the specified number. Let's send to Member 1.
  const targetPhone = mem1 ? mem1.phone.replace(/[^0-9+]/g, '') : '';
  
  if (targetPhone) {
    const waUrl = `https://wa.me/${targetPhone}?text=${textMsg}`;
    window.open(waUrl, '_blank');
  } else {
    // If no phone, just open WhatsApp web search with text
    window.open(`https://wa.me/?text=${textMsg}`, '_blank');
  }
}

// Settings: Unlock Admin Panel
function handleUnlockSettings() {
  const pin = document.getElementById('admin-pin-field').value.trim();
  if (pin === DEFAULT_ADMIN_PIN) {
    isSettingsAdminUnlocked = true;
    updateSettingsView();
    showToast("Admin access unlocked!");
  } else {
    showToast("Invalid PIN code.");
  }
}

// Add a Member (Admin)
async function handleAddMember() {
  const name = document.getElementById('new-member-name').value.trim();
  const phone = document.getElementById('new-member-phone').value.trim();
  const isUserAdmin = document.getElementById('new-member-admin').checked;

  if (!name || !phone) {
    showToast("Name and phone number are required.");
    return;
  }

  showLoading(true);
  try {
    // First we register a mock/testing user on Supabase auth? 
    // In production, users should sign up themselves using Phone OTP. 
    // This form is to manually pre-insert profiles in the database so their names show up 
    // and can be paired before they log in!
    // Since Profiles has a foreign key references auth.users(id), inserting profiles requires a UUID.
    // If we insert a profile for someone who hasn't registered yet, we can use a random UUID.
    // When they eventually log in with that phone number, we can link it!
    // Let's check schema.sql: profiles references auth.users on delete cascade.
    // Wait! Since profiles references auth.users, inserting a row in profiles will FAIL if that user 
    // doesn't exist in auth.users first.
    // To solve this, we can insert users into profiles using a custom trigger or make profiles.id nullable/uuid.
    // But since the schema is already set references auth.users, we can do a smart trick:
    // We can pre-register them, or they can just sign up first.
    // Wait, to allow the admin to add members freely without them being in auth.users, 
    // it's better if the profiles table uses a general primary key, or references auth.users conditionally.
    // In our schema.sql: "profiles (id uuid references auth.users on delete cascade primary key)".
    // So the easiest flow:
    // Users sign up themselves via phone auth (takes 10 seconds), and they get added to the profiles table.
    // Once they exist, the admin can pair them up.
    // But what if they aren't signed up yet and admin wants to define them?
    // Admin can just share the link, everyone signs up, and they appear in Settings.
    // To make it easy: the "Add Member" button can add a mock auth user (or we can explain in settings that members appear once they log in for the first time, OR we can generate a random auth user).
    // Actually, Supabase client doesn't allow creating auth users easily from client side without admin bypass keys.
    // So the best approach: users register themselves. They will automatically appear in the list.
    // Let's modify the Add Member tool so it displays: "To add a member, simply have them open the app and log in. They will be added automatically!"
    // And the "Add Member" button insettings can be replaced by a clean notice, or we can write code to insert a temp profile if we bypass constraints, or just support mock numbers.
    // To be safe and compliant with the schema, we can disable the manual insert if it fails, or explain.
    // Let's write the code to create a custom profile. If it errors because of auth.users constraints, we explain that they must register via OTP first.
    
    const tempId = crypto.randomUUID();
    const newProfile = {
      id: tempId,
      name,
      phone,
      workspace_association: activeWorkspace,
      is_admin: isUserAdmin
    };

    // We can try to insert it. If the DB has FK constraints, this might fail unless we insert into auth.users.
    // For pure client-side sandbox testing, if the FK constraint fails, we catch it and display a helpful tip.
    const { error } = await supabase
      .from('profiles')
      .insert(newProfile);

    if (error) {
      if (error.message.includes('foreign key')) {
        throw new Error("Cannot add members manually. Members must log in via OTP to register their device, after which they will appear here automatically.");
      }
      throw error;
    }

    showToast("Member pre-registered!");
    toggleDrawer('add-member-form-box', false);
    await loadCurrentWorkspaceData();
  } catch (err) {
    showToast(err.message, 5000);
  } finally {
    showLoading(false);
  }
}

// Delete a member (Admin)
window.deleteMember = async function(memberId) {
  if (!confirm("Are you sure you want to delete this member? This will remove all their pairings!")) return;
  
  showLoading(true);
  try {
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', memberId);
      
    if (error) throw error;
    showToast("Member deleted.");
    await loadCurrentWorkspaceData();
  } catch (err) {
    console.error("Member delete error:", err);
    showToast("Error deleting member: " + err.message);
  } finally {
    showLoading(false);
  }
};

// Add a Pair (Admin)
async function handleAddPair() {
  const m1 = document.getElementById('pair-member-1').value;
  const m2 = document.getElementById('pair-member-2').value;

  if (!m1 || !m2) {
    showToast("Select both members to form a pair.");
    return;
  }
  if (m1 === m2) {
    showToast("You cannot pair a member with themselves.");
    return;
  }

  showLoading(true);
  try {
    const { error } = await supabase
      .from('pairs')
      .insert({
        workspace: activeWorkspace,
        member1_id: m1,
        member2_id: m2
      });
      
    if (error) {
      if (error.message.includes('unique_workspace_members')) {
        throw new Error("This pair combination already exists.");
      }
      throw error;
    }

    showToast("Pair created!");
    toggleDrawer('add-pair-form-box', false);
    await loadCurrentWorkspaceData();
  } catch (err) {
    showToast(err.message);
  } finally {
    showLoading(false);
  }
}

// Delete a Pair (Admin)
window.deletePair = async function(pairId) {
  if (!confirm("Delete this pair? Future schedules will automatically re-adjust.")) return;
  
  showLoading(true);
  try {
    const { error } = await supabase
      .from('pairs')
      .delete()
      .eq('id', pairId);

    if (error) throw error;
    showToast("Pair deleted.");
    await loadCurrentWorkspaceData();
  } catch (err) {
    showToast("Error deleting pair: " + err.message);
  } finally {
    showLoading(false);
  }
};

// Delete Self Account
async function handleDeleteAccount() {
  showLoading(true);
  try {
    const userId = session.user.id;
    
    // 1. Delete profile from profiles table (will cascade delete pairs due to FK cascade triggers, 
    // and set duties.pair_id to NULL/cascade depending on setup)
    const { error: profileErr } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);
      
    if (profileErr) throw profileErr;
    
    // Clean session locally
    session = null;
    profile = null;
    localStorage.removeItem('waste_duty_session');
    
    document.getElementById('modal-delete-confirm').classList.add('hidden');
    document.getElementById('main-app-container').classList.add('hidden');
    routeTo('view-login');
    showToast("Your account has been deleted successfully.");
  } catch (err) {
    console.error("Account deletion error:", err);
    showToast("Error deleting account: " + err.message);
    showLoading(false);
  }
}

// Override Swap Modal Handling
let targetOverrideDate = null;

function openOverrideModal(date, duty) {
  targetOverrideDate = date;
  
  const options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
  document.getElementById('override-date-label').innerText = `Assign responsibility for ${date.toLocaleDateString('en-US', options)}`;
  
  // Reset fields
  document.getElementById('override-pin-field').value = "";
  
  const select = document.getElementById('override-pair-select');
  select.innerHTML = `<option value="">Default Rotation</option>`;
  
  pairs.forEach(p => {
    select.innerHTML += `<option value="${p.id}" ${duty.pair_id === p.id && duty.is_override ? 'selected' : ''}>${getPairMemberNames(p)}</option>`;
  });
  
  // Show auth step if not unlocked, else show selection directly
  if (isSettingsAdminUnlocked || (profile && profile.is_admin)) {
    document.getElementById('override-admin-auth').classList.add('hidden');
    document.getElementById('override-selection-box').classList.remove('hidden');
  } else {
    document.getElementById('override-admin-auth').classList.remove('hidden');
    document.getElementById('override-selection-box').classList.add('hidden');
  }
  
  document.getElementById('modal-override').classList.remove('hidden');
}

function closeOverrideModal() {
  document.getElementById('modal-override').classList.add('hidden');
  targetOverrideDate = null;
}

async function handleSaveOverride() {
  const pinField = document.getElementById('override-pin-field');
  const pairSelect = document.getElementById('override-pair-select');
  
  const dateStr = formatDateToYYYYMMDD(targetOverrideDate);
  const dutyType = getDutyTypeForDate(targetOverrideDate);
  
  const isAuth = isSettingsAdminUnlocked || (profile && profile.is_admin);
  
  // 1. Verify PIN if not unlocked
  if (!isAuth) {
    if (pinField.value.trim() !== DEFAULT_ADMIN_PIN) {
      showToast("Invalid Admin PIN.");
      return;
    }
    // PIN accepted, temporarily unlock
    isSettingsAdminUnlocked = true;
    updateSettingsView();
  }

  showLoading(true);
  try {
    const selectedPairId = pairSelect.value || null;
    
    // Find if a duty record already exists for this day
    const existing = duties.find(d => d.date === dateStr && d.duty_type === dutyType);
    
    if (existing) {
      // Update override
      const { error } = await supabase
        .from('duties')
        .update({
          override_pair_id: selectedPairId
        })
        .eq('id', existing.id);
        
      if (error) throw error;
    } else {
      // Insert new record with override
      const { error } = await supabase
        .from('duties')
        .insert({
          workspace: activeWorkspace,
          date: dateStr,
          duty_type: dutyType,
          override_pair_id: selectedPairId
        });
        
      if (error) throw error;
    }

    showToast("Swap applied!");
    closeOverrideModal();
    await loadCurrentWorkspaceData();
  } catch (err) {
    console.error("Override save error:", err);
    showToast("Error applying swap: " + err.message);
  } finally {
    showLoading(false);
  }
}

// 7. PWA INSTALLATION SUPPORT
function setupPwaInstall() {
  const btnInstall = document.getElementById('btn-pwa-install');
  const installContainer = document.getElementById('pwa-install-supported');
  const iosBox = document.getElementById('pwa-install-ios');

  // Detect iOS Safari
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  
  if (isIos && isSafari) {
    // Show iOS visual help box
    iosBox.classList.remove('hidden');
    installContainer.classList.add('hidden');
  } else {
    // Standard PWA install trigger setup
    iosBox.classList.add('hidden');
    
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent standard mini-infobar from appearing on mobile
      e.preventDefault();
      installPromptEvent = e;
      
      // Update UI to notify user app can be installed
      installContainer.classList.remove('hidden');
    });

    btnInstall.addEventListener('click', async () => {
      if (!installPromptEvent) return;
      
      // Show native install dialog
      installPromptEvent.prompt();
      
      // Wait for user choice
      const { outcome } = await installPromptEvent.userChoice;
      console.log(`PWA install user choice: ${outcome}`);
      
      // Clear prompt cache
      installPromptEvent = null;
      installContainer.classList.add('hidden');
    });
    
    window.addEventListener('appinstalled', (evt) => {
      console.log('Duty Rotator app installed!');
      installContainer.classList.add('hidden');
      showToast("App installed successfully! Check your home screen.");
    });
  }
}

// 8. UTILITY HELPERS
function routeTo(viewId) {
  // Hide all screens
  document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
  
  if (viewId) {
    document.getElementById(viewId).classList.add('active');
  } else {
    // Showing main app tabs instead of auth screens
    document.getElementById('view-login').classList.remove('active');
    document.getElementById('view-signup').classList.remove('active');
  }
}

function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  const msgSpan = document.getElementById('toast-message');
  
  msgSpan.innerText = message;
  toast.classList.add('visible');
  
  setTimeout(() => {
    toast.classList.remove('visible');
  }, duration);
}

function showLoading(visible) {
  const overlay = document.getElementById('loading-overlay');
  if (visible) {
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

function toggleDrawer(drawerId, forceState) {
  const box = document.getElementById(drawerId);
  const isHidden = box.classList.contains('hidden');
  const shouldShow = forceState !== undefined ? forceState : isHidden;
  
  if (shouldShow) {
    box.classList.remove('hidden');
  } else {
    box.classList.add('hidden');
  }
}

function formatDateToYYYYMMDD(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Web Push Notifications Subscription Logic

// Utility to convert Base64 URL Safe to Uint8Array for VAPID key
function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Initialize Push Toggle UI state
async function initPushNotificationToggle() {
  const togglePush = document.getElementById('toggle-push-notifications');
  const statusLabel = document.getElementById('push-permission-status');
  if (!togglePush || !statusLabel) return;

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    togglePush.disabled = true;
    statusLabel.innerText = "Status: Unsupported on this browser/device";
    return;
  }

  if (Notification.permission === 'denied') {
    togglePush.disabled = true;
    togglePush.checked = false;
    statusLabel.innerText = "Status: Permission Blocked in Browser Settings";
    return;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    
    if (subscription) {
      // Check if we are logged in and if sub is registered in Supabase
      if (session) {
        // Just verify UI checked state
        togglePush.checked = true;
        statusLabel.innerText = "Status: Reminders Active (Subscribed)";
      } else {
        // Logged out, clear subscription locally just in case
        togglePush.checked = false;
        statusLabel.innerText = "Status: Disabled (Log in to enable)";
      }
    } else {
      togglePush.checked = false;
      statusLabel.innerText = "Status: Disabled";
    }
  } catch (err) {
    console.error("Error checking push status:", err);
    statusLabel.innerText = "Status: Checking failed";
  }
}

// Handle Push Toggle Switch changes
async function handlePushToggleChange(e) {
  if (!session) {
    showToast("Please log in to register push notifications.");
    e.target.checked = false;
    return;
  }

  const statusLabel = document.getElementById('push-permission-status');
  const checked = e.target.checked;
  
  showLoading(true);
  try {
    const reg = await navigator.serviceWorker.ready;
    
    if (checked) {
      // 1. Request permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showToast("Notification permission was denied.");
        e.target.checked = false;
        if (statusLabel) statusLabel.innerText = "Status: Permission Denied";
        showLoading(false);
        return;
      }
      
      // 2. Subscribe using VAPID public key
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY)
      });
      
      // 3. Extract credentials
      const rawSub = JSON.parse(JSON.stringify(subscription));
      const endpoint = rawSub.endpoint;
      const p256dh = rawSub.keys.p256dh;
      const auth = rawSub.keys.auth;
      
      // 4. Save to Supabase push_subscriptions
      const { error } = await supabase
        .from('push_subscriptions')
        .insert({
          profile_id: session.user.id,
          endpoint,
          p256dh,
          auth
        });
        
      if (error) {
        if (error.message.includes('duplicate key')) {
          // Already exists in DB, ignore error
        } else {
          throw error;
        }
      }
      
      if (statusLabel) statusLabel.innerText = "Status: Reminders Active (Subscribed)";
      showToast("Push notifications successfully enabled!");
    } else {
      // Unsubscribe
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        
        // 1. Unsubscribe from browser
        await subscription.unsubscribe();
        
        // 2. Delete from Supabase
        const { error } = await supabase
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', endpoint);
          
        if (error) console.error("Failed to delete subscription row from Supabase:", error);
      }
      
      if (statusLabel) statusLabel.innerText = "Status: Disabled";
      showToast("Notifications disabled.");
    }
  } catch (err) {
    console.error("Failed to update push subscription:", err);
    showToast("Error updating push subscription: " + err.message);
    e.target.checked = !checked; // revert switch
  } finally {
    showLoading(false);
  }
}
