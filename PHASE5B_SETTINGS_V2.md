# MindCanvas — Phase 5b Build Prompt v2 (Settings + Themes + Account)

## Full context (assume zero prior memory — read all of this before touching code)

You're working on **MindCanvas**, a brain-dump notes + knowledge graph app.
Solo founder, non-technical ("vibe coder") — explain what you're doing in plain
terms. **Strict £10/month total budget** — flag any new cost before adding
anything paid.

**Stack:** Next.js App Router, Tailwind CSS, @xyflow/react, Dexie (local cache),
Supabase (Postgres + RLS, email/password auth, real source of truth). Deployed
on Vercel, auto-deploys from GitHub (`Projectceo-hub/Brain-dumper-Project`) on
push to `main`. Live at brain-dumper-project.vercel.app.

**Existing design system (the default "Warm Canvas" theme — do not change this):**
- Background: `#F2EDE4` (bone)
- Text: `#1C1912` (ink)
- Primary accent: `#C4571F` (clay-orange)
- Secondary: `#3D6B5C` (pine green)
- Supporting: `#DCE4DC` (sage), `#EDDFCB` (tan)
- Warm gray: `#8A8071` / `#6B6459` / `#A39A8A`
- Sidebar background: `#1C1912` (ink)
- Sidebar text: `#F2EDE4` (bone)
- Fonts: Fraunces (serif, headings) + Inter (sans, body/UI)

**Current routes:**
- `/` — Dashboard
- `/folder/[id]` — Folder detail + note editor
- `/graph` — Graph views
- `/settings/tokens` — API token management (keep exactly as-is)
- `/api/*` — Do not touch
- `/oauth/*` — Do not touch

---

## CRITICAL REQUIREMENT: Contrast Ratios

**Every theme must pass WCAG AA contrast requirements (4.5:1 minimum for normal
text, 3:1 for large text/headings).** Before writing a single theme color, verify
the contrast ratio between the text color and background color. A dark theme
with dark text is a critical failure — do not ship it.

For each theme, you MUST verify and state the contrast ratio for:
- Body text on page background
- Body text on card/surface background
- Sidebar text on sidebar background

If any ratio is below 4.5:1, adjust the colors until it passes.

---

## Part A: Settings Page Structure

Create `/settings/page.js` as the main settings hub using the existing Sidebar
component. Three sections: Account, Appearance, Integrations.

Update the sidebar to link to `/settings` instead of `/settings/tokens` directly.
Use a gear icon (⚙) as the sidebar link label.

---

## Part B: Account Section

**Display name:**
- Text input, saved via `supabase.auth.updateUser({ data: { display_name } })`
- Shows in sidebar bottom instead of raw email if set
- Falls back to email if not set

**Change email:**
- Input for new email, calls `supabase.auth.updateUser({ email: newEmail })`
- Show message: "Confirmation links will be sent to both your current and new
  email addresses"

**Change password:**
- Current password + new password + confirm new password fields
- Validate new === confirm before submitting
- Call `supabase.auth.updateUser({ password: newPassword })`

**Delete account (Danger Zone):**
- Muted red border section at bottom of Account section
- Red delete button (use `#DC2626`, NOT the clay accent color)
- Inline confirmation — user must type "DELETE" before final button activates
  (do NOT use browser confirm())
- On confirmed:
  1. Create DELETE /api/account route using service role to delete user's
     notes, folders, then the auth user itself
  2. Sign out
  3. Redirect to login
- Show clear error if deletion fails, do not sign out on failure

---

## Part C: Theme System

### Architecture

Use CSS custom properties on the html element via a data-theme attribute.
Create src/components/ThemeProvider.jsx as a use client component that:
- Reads localStorage.getItem('mindcanvas:theme') on mount
- Sets document.documentElement.setAttribute('data-theme', theme)
- Defaults to 'warm-canvas' if nothing stored
- Exposes a setTheme(name) function via a custom event

Include ThemeProvider in src/app/layout.js.

### The Five Themes

Add these to globals.css. Each theme MUST have verified contrast ratios.

**Theme 1: Warm Canvas (default — must exactly match existing design)**
```css
:root, [data-theme="warm-canvas"] {
  --bg: #F2EDE4;
  --surface: rgba(255,255,255,0.6);
  --surface-solid: #FFFFFF;
  --text-primary: #1C1912;
  --text-secondary: #6B6459;
  --text-muted: #8A8071;
  --accent: #C4571F;
  --accent-secondary: #3D6B5C;
  --sidebar-bg: #1C1912;
  --sidebar-text: #F2EDE4;
  --sidebar-text-muted: #8A8071;
  --border: rgba(139,128,113,0.25);
  --card-hover: rgba(237,223,203,0.55);
}
```
Contrast: #1C1912 on #F2EDE4 = 14.7:1

**Theme 2: Dark Studio**
```css
[data-theme="dark-studio"] {
  --bg: #1A1815;
  --surface: #252220;
  --surface-solid: #252220;
  --text-primary: #E8E0D4;
  --text-secondary: #A89880;
  --text-muted: #7A6E62;
  --accent: #D4651F;
  --accent-secondary: #4A8A6F;
  --sidebar-bg: #111009;
  --sidebar-text: #E8E0D4;
  --sidebar-text-muted: #7A6E62;
  --border: rgba(232,224,212,0.12);
  --card-hover: rgba(232,224,212,0.06);
}
```
Contrast: #E8E0D4 on #1A1815 = 11.2:1, on #252220 = 8.9:1

**Theme 3: Midnight**
```css
[data-theme="midnight"] {
  --bg: #0A0A0A;
  --surface: #161616;
  --surface-solid: #161616;
  --text-primary: #F0EDE8;
  --text-secondary: #9A9088;
  --text-muted: #6A6058;
  --accent: #C4571F;
  --accent-secondary: #3D8A6F;
  --sidebar-bg: #050505;
  --sidebar-text: #F0EDE8;
  --sidebar-text-muted: #6A6058;
  --border: rgba(240,237,232,0.1);
  --card-hover: rgba(240,237,232,0.05);
}
```
Contrast: #F0EDE8 on #0A0A0A = 18.1:1, on #161616 = 13.4:1

**Theme 4: Sepia**
```css
[data-theme="sepia"] {
  --bg: #F5EDD6;
  --surface: rgba(253,246,227,0.8);
  --surface-solid: #FDF6E3;
  --text-primary: #2C1F0E;
  --text-secondary: #5C4A2A;
  --text-muted: #8C7A5A;
  --accent: #A8380A;
  --accent-secondary: #4A6A30;
  --sidebar-bg: #2C1F0E;
  --sidebar-text: #F5EDD6;
  --sidebar-text-muted: #8C7A5A;
  --border: rgba(44,31,14,0.2);
  --card-hover: rgba(44,31,14,0.06);
}
```
Contrast: #2C1F0E on #F5EDD6 = 13.8:1, on #FDF6E3 = 15.1:1

**Theme 5: Slate**
```css
[data-theme="slate"] {
  --bg: #EEF2F7;
  --surface: rgba(255,255,255,0.75);
  --surface-solid: #FFFFFF;
  --text-primary: #0F1923;
  --text-secondary: #4A5568;
  --text-muted: #718096;
  --accent: #C4571F;
  --accent-secondary: #2B5DA8;
  --sidebar-bg: #0F1923;
  --sidebar-text: #EEF2F7;
  --sidebar-text-muted: #718096;
  --border: rgba(15,25,35,0.15);
  --card-hover: rgba(15,25,35,0.05);
}
```
Contrast: #0F1923 on #EEF2F7 = 16.2:1, on #FFFFFF = 19.5:1

### Applying themes to the app

DO NOT replace every hardcoded Tailwind class in the entire codebase.
Only update these specific elements:

1. Body background — add style={{ background: 'var(--bg)' }} to the body
   in layout.js alongside the existing className
2. Sidebar container background — change hardcoded #1C1912 to var(--sidebar-bg)
3. Sidebar text — change bone/warm-gray classes to use var(--sidebar-text)
   and var(--sidebar-text-muted) via inline styles where needed
4. Dashboard page background — the outermost div's bg-bone class gets an
   additional style={{ background: 'var(--bg)' }}
5. Folder page background — same as dashboard
6. Graph page background — same

Everything else stays as Tailwind classes. This is intentionally conservative.

### Theme picker UI

Five 48x48px circle swatches in a row in the Appearance section:
- Outer ring color: the theme's --bg color
- Inner 32x32px circle: the theme's --accent color
- Active theme: white checkmark on accent circle
- Below each: theme name in 11px Inter

Clicking a swatch updates localStorage and dispatches a themechange custom
event. ThemeProvider listens for this and applies it to html immediately.

---

## Part D: Integrations Section

Two cards:
1. API Tokens — links to /settings/tokens. "Connect MindCanvas to Claude
   Desktop and other MCP clients"
2. Claude.ai Web Connector — greyed out, "Coming soon" badge. "Connect
   directly to claude.ai in your browser"

---

## What NOT to do

- Do not replace ALL Tailwind hardcoded colors — only the targeted list above
- Do not touch /api/organize, /api/mcp, /api/oauth/*
- Do not add npm packages without flagging
- Do not use confirm() dialogs — use inline confirmation UI
- Do not skip contrast ratio verification — state the ratios in your report

---

## Verification checklist

Themes:
1. Switch to each of the 5 themes — text readable on ALL of them
2. No theme has text that blends into background
3. Sidebar text visible on all themes
4. Refresh — theme persists
5. Navigate to folder and graph pages — theme applies there too
6. Switch back to Warm Canvas — exactly matches original design

Account:
1. Set display name — appears in sidebar
2. Change password — new password works on next login
3. Change email — confirmation emails sent
4. Delete account — types DELETE, all data gone, redirected to login

Settings structure:
1. Sidebar gear icon navigates to /settings
2. All three sections visible
3. API Tokens link goes to /settings/tokens

---

## Commit/push policy

Run npm run build first. State the contrast ratios for each theme in your
completion report. Do not commit without founder confirmation.
