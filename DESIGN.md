# FinanceTracker Design System: "Aurora Glass"

This is the visual language for the whole app. **Every agent or developer adding UI must
follow this file.** If something you need isn't covered, extend the system (tokens and
primitives) rather than hard-coding one-off styles, then document the addition here.

> Source of truth: `src/app/globals.css` (tokens and utilities) and `src/components/ui/*`
> (primitives). This document explains them; the code wins if they ever disagree.

---

## 1. Principles

1. **Calm and premium.** The app shows people's money, so it should feel trustworthy and quiet.
   Use generous spacing and few colours, and let the numbers carry the emphasis.
2. **Glass on aurora.** Content sits on translucent, blurred panels floating above a slowly
   drifting colour backdrop (`<AuroraBackground />`). Glass only works if there is something
   behind it, so every full-page layout renders the aurora once.
3. **Semantic tokens only.** Never write `bg-white`, `text-slate-600`, `dark:bg-zinc-900` or
   hex values in components. Use the tokens below. Light/dark switching happens in the
   tokens, so components need **no `dark:` variants** in almost all cases.
4. **Both themes are first-class.** Check every screen in Light *and* Dark before calling it done.
5. **Accessible by default.** Visible focus rings, `aria-*` on interactive custom controls,
   AA contrast for text, and `prefers-reduced-motion` respected (handled globally).

---

## 2. Theming

- The theme is stored in `localStorage["ft-theme"]` as `"light" | "dark"`. If the key is
  missing, the app follows the system setting.
- `src/components/theme/theme-script.ts` runs inline in `<head>` and sets
  `<html data-theme="light|dark">` **before first paint**, so the page never flashes the
  wrong theme.
- `ThemeProvider` (in the root layout) exposes `useTheme()` → `{ theme, resolvedTheme, setTheme }`.
- `<ThemeToggle />` is the segmented Light / Dark / System control. Put it in every top bar.
- Tailwind's `dark:` variant is remapped to `[data-theme="dark"]`. Use it only for genuine
  exceptions, such as swapping an illustration.

### Accent colour (user-selectable)

- Users pick an accent colour from the presets **Emerald** (default), **Purple**, **Orange**, **Red**, **Blue**
  and **Pink**, or choose their own with the custom picker. The picker lives in `AccentPicker`, which
  appears in the navbar's `AppearanceMenu` (palette icon) and in Settings → Appearance.
- Every accent shade (`accent`, `accent-strong`, `accent-soft`, `accent-2`, `accent-3`, aurora glows and
  `shadow-glow`) is generated in `globals.css` with `oklch()` from just two variables,
  `--accent-h` (hue) and `--accent-c` (chroma). Lightness is fixed per light/dark mode, so every colour
  keeps the same contrast.
- The choice is stored in `localStorage["ft-accent"]` (`{ id, h, c, hex? }`) and applied before first
  paint by `accentInitScript` (`src/components/theme/accent.ts`). `useTheme()` exposes `accent` and `setAccent`.
- **Never hard-code the brand colour.** Anything "brand" must use the accent tokens, so it follows the
  user's choice. To add a preset, add a row to `ACCENT_PRESETS`.

---

## 3. Tokens (Tailwind utilities)

| Purpose | Utility | Notes |
|---|---|---|
| Page background | `bg-canvas` | Behind the aurora |
| Primary text | `text-fg` | Headings, values |
| Secondary text | `text-fg-muted` | Body copy, labels |
| Tertiary text | `text-fg-subtle` | Hints, placeholders, meta |
| Hairline border | `border-line` | Default 1px borders and dividers |
| Stronger border | `border-line-strong` | Hover, inactive tracks |
| Brand accent | `text-accent` / `bg-accent` | Follows the user's colour choice. Links, active states, CTAs |
| Accent hover | `text-accent-strong` | |
| Accent tint | `bg-accent-soft`, `bg-accent/10` | Badges, selected rows |
| Secondary accents | `accent-2` (teal), `accent-3` (indigo) | Charts, goal rings, gradients |
| Text on accent | `text-accent-fg` | On `bg-brand` / `bg-accent` |
| Money in / positive | `text-positive`, `bg-positive/12` | Always green, whatever the accent |
| Status | `danger`, `warning`, `info` | e.g. `text-danger`, `bg-danger/8`, `border-danger/25` |
| Hover fill on glass | `bg-glass-hover` | Ghost buttons, list rows |
| Input fill | `bg-glass-input` | Form controls |

Opacity modifiers work on all tokens (`bg-accent/12`, `border-danger/60`).

**Money colours:** income and positive deltas use `text-positive` (always green), expenses and negative
deltas use `text-danger` (always red), and neutral amounts use `text-fg`. Never use `accent` for money,
because the accent can be red or orange. Always render amounts with `font-mono`
(Geist Mono) so digits line up.

---

## 4. Surfaces

| Utility | Use for |
|---|---|
| `glass` | Standard panel: stat cards, chips, nav bars, popovers, the theme toggle |
| `glass-strong` | Primary focus surface: auth card, modals, sheets, the main dashboard card |
| `glass-edge` | Add to either one for a light-catching gradient rim (uses `::before`) |
| `bg-brand` | Brand gradient fill: primary buttons, logo mark, progress bars |
| `text-gradient` | Gradient text for hero highlights and the wordmark. Use sparingly. |

Example card:

```tsx
<section className="glass glass-edge rounded-2xl p-5">
  <p className="text-xs font-medium text-fg-muted">Monthly spend</p>
  <p className="mt-2 font-mono text-2xl font-semibold text-fg">$2,340.18</p>
</section>
```

**Materials (Apple-style):** blur and saturation come from the `--glass-blur` / `--glass-blur-strong`
tokens (44px and 64px, saturate 190–210%), and the fills are opaque enough that body text stays readable over
the aurora. Tune them only in `globals.css`. When `backdrop-filter` is unsupported, or the user has
*Reduce Transparency* on, panels automatically switch to near-solid fills.

Rules:
- **Only top-level surfaces blur** (navbar, cards, the auth card, popovers, the tab bar). Controls inside them
  (inputs, OTP cells, alerts, tiles) must **not** add `backdrop-blur-*`. Nested blur is invisible and
  slows iPhone scrolling down.
- **Popovers, menus and sheets opened from a glass surface must be portalled to `<body>`**
  (`createPortal`, `position: fixed`). A parent with `backdrop-filter` becomes the child's backdrop root,
  so a menu rendered inside the navbar can't blur the page. See `AppearanceMenu` for the pattern.
- Don't nest `glass-strong` inside `glass-strong`. Inner panels use `glass` or `bg-glass-hover`.
- At most two levels of glass depth on a screen.
- Elements with `glass-edge` must not rely on their own `::before`.

---

## 5. Shape, spacing, elevation

- **Radius:** `rounded-xl` (12px) for controls, `rounded-2xl` (16px) for cards and chips,
  `rounded-3xl` (24px) for hero/primary cards and modals, `rounded-full` for pills and toggles.
- **Control height:** inputs `h-12`; buttons `h-9` (sm), `h-11` (md), `h-12` (lg). Primary form CTAs use `size="lg"` and `w-full`.
- **Card padding:** `p-5` for small cards, `p-6 sm:p-9` for primary cards.
- **Vertical rhythm in forms:** `space-y-5` between fields.
- **Shadows:** only `shadow-glass` (built into the glass utilities) and `shadow-glow`
  (accent glow on primary buttons and active toggles). Don't use other Tailwind shadows.

---

## 6. Typography

- Font: **Geist** (`font-sans`), with **Geist Mono** (`font-mono`) for all numbers, amounts and codes.
- Page or card title: `text-[26px] font-semibold tracking-tight text-fg`
- Hero headline: `text-4xl xl:text-5xl font-semibold tracking-tight leading-[1.1]`
- Section title: `text-lg font-semibold tracking-tight text-fg`
- Body: `text-sm leading-relaxed text-fg-muted`
- Label: `text-[13px] font-medium text-fg-muted`
- Meta/hint: `text-xs text-fg-subtle`
- Use the ellipsis character `…` in loading labels ("Signing in…").

---

## 7. Motion

Defined as Tailwind animations in `globals.css`:

| Class | Use |
|---|---|
| `animate-rise` | Entrance for cards, alerts, and step changes (re-key the wrapper with `key={step}`) |
| `animate-fade` | Inline helper and error text appearing |
| `animate-float` | Decorative floating chips (marketing/illustration only) |
| `animate-shake` | Invalid OTP / failed submission feedback |
| `animate-aurora` | Background blobs only |

Keep durations between 150 and 300ms for interactions. `prefers-reduced-motion` disables
motion globally, so don't work around it.

---

## 8. Primitives (`src/components/ui`)

Use these; don't re-style raw elements.

| Component | Key props |
|---|---|
| `Button` | `variant: primary \| secondary \| outline \| ghost \| danger`, `size`, `isLoading`, `leftIcon`, `rightIcon`. Exports `buttonBase`, `buttonVariants` and `buttonSizes` for styling a `<Link>` as a button. |
| `Input` | `label`, `error`, `helperText`, `leftIcon`, `rightElement`, `labelAction` (right side of the label row) |
| `PasswordInput` | `Input` with a lock icon and a show/hide toggle |
| `PasswordStrength` | `password`: four-segment meter for new-password fields |
| `Checkbox` | `label`, `description` |
| `Alert` | `variant: error \| success \| warning \| info`, `title`, `onClose` |
| `OtpInput` | `value`, `onChange`, `length`, `hasError`. Split into 3+3 cells, supports paste |
| `AuroraBackground` | Render once per full-page layout |
| `ThemeToggle` | Light / Dark / System segmented control |
| `AccentPicker` | Preset colour swatches + custom colour picker |
| `AppearanceMenu` | Palette button with a popover containing `ThemeToggle` and `AccentPicker`. Used in every top bar. |
| `Modal` | `isOpen`, `onClose`, `title`, `description`, `size: sm \| md \| lg`. Portalled glass-strong dialog with backdrop blur and escape dismissal. |
| `FloatingActionButton` | `onClick`, `label`, `showOnMobile`. Context-aware floating action button (FAB) for page-level primary flows. |

Auth-specific (`src/components/auth`): `AuthLayout` (centered glass card; `title` is
optional), `AuthStepHeader` (icon tile + title + description), `StepIndicator`
(multi-step progress), `BrandLogo` / `BrandMark`.

**Logo:** `BrandMark` is the 3D app mark: a glossy raised tile with an extruded base, three ascending
3D bars (lit top, shaded side) and a rising arrow. It is an inline SVG coloured from the accent tokens,
so it follows the user's theme colour. Always use `BrandMark` / `BrandLogo` and never redraw the mark.
The static favicon `src/app/icon.svg` is the same mark in Emerald and must be kept in sync by hand.

App shell (`src/components/layout`):
- `AppShell` wraps every signed-in page (`userName`, `userEmail`, `currency`). It renders **one floating
  glass navbar at the top**; there is no sidebar.
  - lg+: brand · `TopNav` (segmented pill links) · `AppearanceMenu` · avatar → settings ·
    sign out. A floating **+ New** pill button sits fixed in the bottom-right corner (desktop only).
  - Below lg: brand · `AppearanceMenu` · avatar. Navigation moves to the iPhone tab bar (`BottomNav`):
    Home, Transactions, **raised + Add**, Reports, Settings, padded with `env(safe-area-inset-*)`.
- `PageHeader` (`eyebrow`, `title`, `description`, `action`): first element on every page.
- `NAV_ITEMS` / `ADD_TRANSACTION_HREF` in `nav-items.ts` are the single source for navigation.
  Add new top-level routes there, not in the components.
- `UserAvatar`: initials on the brand gradient.

Content primitives: `Card` (`title`, `description`, `action`; glass + edge, `rounded-2xl`),
`CardLink` (header "View all" link), `EmptyState` (icon, one-line title, optional description/action).
Money: `formatMoney(amount, currency, { compact })` from `@/lib/format` (INR → en-IN grouping).

Combine classes with `cn()` from `@/lib/cn` (clsx + tailwind-merge) so callers can override them.

Icons: `lucide-react`, sized `h-4 w-4` inside controls and `h-5 w-5` in icon tiles.

---

## 9. Patterns

- **Forms:** validate on submit, clear a field's error as the user types, show the server
  error in an `Alert` at the top of the form, and keep the primary CTA full-width at the bottom.
- **Multi-step flows:** `StepIndicator`, then `AuthStepHeader`, then content, with the wrapper
  re-keyed by step so `animate-rise` plays on each transition.
- **Links:** `font-semibold text-accent hover:text-accent-strong underline-offset-4 hover:underline`.
- **Dividers:** `border-t border-line`.
- **Dashboard:** a balance hero (`glass-strong`, big `font-mono` total, month Income / Expenses / Saved
  tiles), then a 2/3 + 1/3 grid: Recent transactions and Cash flow on the left; Accounts and Top
  spending on the right. On mobile it is one column in that order.
- **Never show fake numbers.** Until a feature exists, show zeros and an `EmptyState`.
- **Empty or illustrative data:** label sample figures clearly (e.g. a "Sample" badge).
  Never present invented statistics as real.
- **Personal app, minimal copy:** this is a single-user app. No marketing panels, taglines,
  trust badges, terms/consent checkboxes or decorative controls that don't do anything. Keep
  titles short ("Welcome back", "Create account"), use subtitles only when they carry
  information, keep error messages to one short sentence, and show each navigation link once.

---

## 10. Checklist before you ship UI

- [ ] No raw palette classes (`slate-*`, `zinc-*`, `gray-*`, `emerald-*`, `bg-white`, hex values) in components
- [ ] Looks right in Light, Dark and System, with no theme flash on reload
- [ ] Works at 360px width with no horizontal scroll
- [ ] Keyboard: focus ring visible, tab order logical, Enter submits
- [ ] Amounts use `font-mono`; positive values use `accent`, negative values use `danger`
- [ ] Uses existing primitives; any new primitive is added to section 8

## Migration status

Done: root layout, theme system, all primitives, auth pages, app shell, `/home` dashboard layout
(empty-state data), and `/transactions`, `/reports` and `/settings` (on the shell).
Next: wire the dashboard to real account and transaction data, and build the add-transaction flow
(the Add button currently opens `/transactions`).
