# Duty Rotator 🧹✨

A premium, highly interactive, and responsive Progressive Web Application (PWA) designed for tracking office and household chores. Built using an **Obsidian "iOS 26" Glassmorphic Design Language**, it features a fully animated, responsive animatronic robot mascot that interacts in real-time as users fill out forms, log in, or encounter errors.

---

## 🚀 Live Demo & Repository
- **GitHub Repository**: [https://github.com/abzops/duty-rotator.git](https://github.com/abzops/duty-rotator.git)

---

## 💎 Premium Design & Interactions
- **iOS 26 Glassmorphic UI**: Authentic frosted glass cards (`backdrop-filter: blur(25px)`), thin reflective borders, obsidian-dark ambient background glows, and high-contrast typography.
- **Interactive Robot Mascot**: An animated robot head with double waving arms, pulsing antenna light, and dynamic expressions:
  - **Waving (Idle)**: Symmetrically animated left and right arms wave in default states.
  - **Happy (Appreciation)**: Blinks antenna green, smiles wider, waves arms rapidly, and turns eyes into curved happy arcs when names are typed or options selected.
  - **Peek-a-boo (PIN Focus)**: Fold arms over its eyes and closes them into thin slits when focusing on the 6-digit password input.
  - **Sad (Error Feedback)**: Frowns, turns eyes and antenna flashing warning red, and droops both arms downward when credentials fail or registration errors occur, reading the error message out directly.
- **Context-Aware Dialogue**: Responsive glass bubbles that hover precisely touching the robot's antenna, rendering natural wrapping text instructions based on input actions.
- **Micro-Animations**: Elastic bouncing transitions, smooth sliding controls, and canvas confetti celebrations on task completion.

---

## 🛠️ Feature Checklist
- [x] **Secure PIN-Based Login/Signup**: Simple credentials requiring only Name, Mobile Number (+91), and a secret 6-digit PIN. No complex OTP wait times.
- [x] **iOS Segmented Control**: Custom horizontal sliding selector for choosing workspace association (Office, House, Both) during registration.
- [x] **Today's Mission Dashboard**: View current day's active pair, current chore type (Food Waste or Plastic), and completion checkmarks.
- [x] **WhatsApp Reminder Dispatch**: Generates automated funny reminder templates to prompt the responsible pair over WhatsApp in one click.
- [x] **Interactive Calendar (Pinch Zoom)**: 
  - **Day View**: Clean navigator to swipe through daily assignments.
  - **Month View**: Detailed grid tracking duty rotations, zoomable with standard gestures or toggle buttons.
- [x] **Admin Settings Panel**: Unlock with an administrator PIN to manually register members, build pairings, override specific daily rotations (Swap pairs), or delete profiles.
- [x] **Progressive Web App (PWA)**: Completely installable on home screens, configured with apple-mobile-web-app capabilities, standard manifests, and caching service workers for offline loading.

---

## ⚙️ Tech Stack
- **Frontend Core**: Vanilla HTML5, CSS3 Custom Properties (Harmonious obsidian dark-mode color palettes).
- **Client Logic**: Vanilla ES6 JavaScript (zero heavy framework dependencies).
- **Backend & Database**: **Supabase** (Profiles, Pairs, Duties tracking) with native schema foreign key cascade triggers.
- **Third-Party Libraries (CDNs)**:
  - [Lucide Icons](https://lucide.dev/) for crisp vector iconography.
  - [Canvas Confetti](https://github.com/catidad/canvas-confetti) for complete success celebrations.

---

## 📂 Database Setup
Apply the provided SQL schema migrations inside your Supabase SQL editor:
1. **`schema.sql`**: Configures database extensions and creates the master `profiles` table.
2. **`migration.sql`**: Sets up `pairs` and `duties` tables with appropriate unique indexes.
3. **`migration_house.sql` & `migration_pin.sql`**: Upgrades pairs columns and secures PIN fields.

---

## 📦 Local Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/abzops/duty-rotator.git
   cd duty-rotator
   ```

2. **Configure Supabase Credentials**:
   Create or edit the `config.js` file in the root directory and update it with your credentials:
   ```javascript
   const SUPABASE_URL = "https://your-supabase-url.supabase.co";
   const SUPABASE_ANON_KEY = "your-anon-key";
   ```

3. **Serve Locally**:
   Run a local dev server (e.g. using Python, Node, or Live Server):
   ```bash
   # Python 3
   python -m http.server 8000
   
   # Node.js static server
   npm install -g local-server
   local-server --port=8000
   ```
   Open `http://localhost:8000` in your web browser.

---

## 📄 License
This project is open-source and available under the MIT License.
