# UI Refactor Guide: Achieving Chorus-Level Polish

This document provides a comprehensive guide for refactoring Superset's UI to match the level of polish and sophistication found in Chorus.

---

## Executive Summary

Chorus achieves its polished feel through:
1. **HSL-based color system** with 11-shade scales
2. **Subtle, consistent animations** (200-500ms, ease-out)
3. **Precise typography** with variable fonts and letter-spacing
4. **Glassmorphism hints** (backdrop blur, transparency)
5. **Micro-interactions** on every interactive element
6. **Consistent spacing** following 4px grid (0.25rem multiples)

---

## 1. Color System Overhaul

### Current Problem
Most apps use flat, limited color palettes that feel utilitarian.

### Chorus Approach
HSL-based 11-shade color scales that provide nuance and depth.

### Implementation

Update your Tailwind config and CSS variables:

```css
/* packages/ui/src/styles/globals.css */

:root {
  /* Gray scale - Cool grays with slight warmth (60° hue) */
  --gray-0: 0 0% 100%;
  --gray-25: 60 17% 99%;
  --gray-50: 60 9% 98%;
  --gray-100: 60 5% 96%;
  --gray-200: 60 6% 93%;
  --gray-300: 48 5% 84%;
  --gray-400: 49 4% 65%;
  --gray-500: 43 4% 51%;
  --gray-600: 44 4% 42%;
  --gray-700: 48 4% 32%;
  --gray-800: 51 6% 21%;
  --gray-900: 60 6% 12%;
  --gray-950: 60 7% 8%;

  /* Accent scale - Warm tone for highlights */
  --accent-25: 32 49% 95%;
  --accent-50: 32 59% 93%;
  --accent-100: 31 57% 88%;
  --accent-200: 31 51% 79%;
  --accent-300: 30 47% 67%;
  --accent-400: 29 42% 55%;
  --accent-500: 27 38% 45%;
  --accent-600: 25 38% 37%;
  --accent-700: 23 36% 30%;
  --accent-800: 21 33% 25%;
  --accent-900: 19 30% 21%;

  /* Special color for focus states */
  --special: 19 51% 70%;

  /* Semantic mappings - Light mode */
  --background: var(--gray-0);
  --foreground: var(--gray-900);
  --muted: var(--gray-100);
  --muted-foreground: var(--gray-500);
  --border: var(--gray-200);
  --input: var(--gray-200);
  --ring: var(--gray-400);
  --highlight: var(--accent-25);
  --highlight-foreground: var(--accent-900);

  /* Overlay for dialogs/modals */
  --overlay: 60 71% 7% / 4%;
}

.dark {
  --background: var(--gray-950);
  --foreground: var(--gray-50);
  --muted: var(--gray-800);
  --muted-foreground: var(--gray-400);
  --border: var(--gray-800);
  --input: var(--gray-800);
  --ring: var(--gray-700);
  --highlight: var(--accent-800);
  --highlight-foreground: var(--accent-100);
  --overlay: 60 71% 7% / 40%;
}
```

### Key Principle
Always use semantic color variables (`--foreground`, `--muted`) rather than specific shades. This ensures dark mode works automatically.

---

## 2. Typography System

### Target Specifications

```typescript
// packages/ui/tailwind.config.ts

const config = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['"SF Pro"', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', '"Fira Code"', '"JetBrains Mono"', 'monospace'],
      },
      fontSize: {
        xs: ['10px', { lineHeight: '12px' }],
        sm: ['12px', { lineHeight: '16px' }],
        base: ['14px', { lineHeight: '20px' }],
        lg: ['16px', { lineHeight: '24px' }],
        xl: ['20px', { lineHeight: '28px' }],
      },
      fontWeight: {
        light: '250',
        normal: '400',
        medium: '450',
        semibold: '500',
      },
      letterSpacing: {
        normal: '0.14px',
        wide: '0.24px',
        wider: '0.6px',
        widest: '1.44px',  // For uppercase labels
      },
    },
  },
};
```

### Typography Classes to Add

```css
/* Sidebar/label styling like Chorus */
.label-uppercase {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1.44px;
  font-weight: 450;
}

/* Enable font ligatures */
.font-features {
  font-feature-settings: "rlig" 1, "calt" 1;
}
```

### Usage Guidelines

| Element | Size | Weight | Tracking |
|---------|------|--------|----------|
| Body text | `base` (14px) | `normal` (400) | `normal` |
| Labels | `xs` (10px) | `medium` (450) | `widest` |
| Headings | `lg`/`xl` | `semibold` (500) | `normal` |
| Code/mono | `sm` (12px) | `normal` (400) | `normal` |
| Buttons | `base` (14px) | `medium` (450) | `normal` |

---

## 3. Spacing & Border Radius

### Spacing Scale (4px grid)

Always use multiples of 4px:
- `p-1` = 4px
- `p-2` = 8px
- `p-3` = 12px
- `p-4` = 16px
- `p-6` = 24px
- `p-8` = 32px

### Component Spacing Standards

| Component | Padding | Gap |
|-----------|---------|-----|
| Card | `p-6` (24px) | `space-y-4` |
| Card Header | `p-6` (24px) | `space-y-1.5` |
| Card Content | `p-6 pt-0` | - |
| Button | `px-4 py-2` | `gap-2` |
| Input | `px-3 py-2` | - |
| Badge | `px-2 py-0.5` | - |
| Dialog | `p-6` | `gap-4` |

### Border Radius System

```typescript
// Use CSS variable for consistency
borderRadius: {
  lg: 'var(--radius)',           // 0.5rem (8px) - buttons, inputs
  md: 'calc(var(--radius) - 2px)', // 6px
  sm: 'calc(var(--radius) - 4px)', // 4px
  xl: '1.25rem',                 // 20px - cards
  full: '9999px',                // pills, badges
}
```

### Application Guide

| Element | Radius |
|---------|--------|
| Cards | `rounded-xl` (20px) |
| Buttons | `rounded-lg` (8px) |
| Inputs | `rounded` (4px) |
| Badges/Pills | `rounded-full` |
| Dialogs | `rounded-md` (6px) |
| Popovers | `rounded-md` (6px) |

---

## 4. Animation System

### Core Timing Values

```typescript
// packages/ui/tailwind.config.ts

keyframes: {
  'accordion-down': {
    from: { height: '0' },
    to: { height: 'var(--radix-accordion-content-height)' },
  },
  'accordion-up': {
    from: { height: 'var(--radix-accordion-content-height)' },
    to: { height: '0' },
  },
  'fade-in': {
    from: { opacity: '0' },
    to: { opacity: '1' },
  },
  'fade-out': {
    from: { opacity: '1' },
    to: { opacity: '0' },
  },
  'slide-in-from-top': {
    from: { transform: 'translateY(-8px)', opacity: '0' },
    to: { transform: 'translateY(0)', opacity: '1' },
  },
  'slide-in-from-bottom': {
    from: { transform: 'translateY(8px)', opacity: '0' },
    to: { transform: 'translateY(0)', opacity: '1' },
  },
  'zoom-in': {
    from: { transform: 'scale(0.95)', opacity: '0' },
    to: { transform: 'scale(1)', opacity: '1' },
  },
  'shimmer': {
    from: { backgroundPosition: '200% 0' },
    to: { backgroundPosition: '-200% 0' },
  },
},
animation: {
  'accordion-down': 'accordion-down 0.2s ease-out',
  'accordion-up': 'accordion-up 0.2s ease-out',
  'fade-in': 'fade-in 0.2s ease-out',
  'fade-out': 'fade-out 0.2s ease-out',
  'slide-in-top': 'slide-in-from-top 0.2s ease-out',
  'slide-in-bottom': 'slide-in-from-bottom 0.2s ease-out',
  'zoom-in': 'zoom-in 0.2s ease-out',
  'shimmer': 'shimmer 5s linear infinite',
},
```

### Timing Guidelines

| Interaction Type | Duration | Easing |
|------------------|----------|--------|
| Hover states | 150ms | `ease` |
| Color transitions | 200ms | `ease-out` |
| Micro-interactions | 200ms | `ease-out` |
| Panel open | 500ms | `ease-in-out` |
| Panel close | 300ms | `ease-in-out` |
| Page transitions | 300ms | `ease-out` |

### Radix UI Animation Classes

Apply these to all Radix primitives:

```typescript
// For dialogs, popovers, dropdowns
const animationClasses = `
  data-[state=open]:animate-in
  data-[state=closed]:animate-out
  data-[state=closed]:fade-out-0
  data-[state=open]:fade-in-0
  data-[state=closed]:zoom-out-95
  data-[state=open]:zoom-in-95
`;

// Direction-aware slide animations
const slideClasses = `
  data-[side=bottom]:slide-in-from-top-2
  data-[side=left]:slide-in-from-right-2
  data-[side=right]:slide-in-from-left-2
  data-[side=top]:slide-in-from-bottom-2
`;
```

---

## 5. Shadow System

### Shadow Definitions

```typescript
// packages/ui/tailwind.config.ts

boxShadow: {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  diffuse: '0 8px 30px rgb(0 0 0 / 5%)',  // Chorus custom - very subtle
}
```

### Shadow Application

| Element | Shadow | Notes |
|---------|--------|-------|
| Cards | `shadow-sm` | Subtle elevation |
| Dialogs | `shadow-lg` | Strong elevation |
| Dropdowns | `shadow-md` | Medium elevation |
| Switch thumb | `shadow-lg` | Emphasize grabbable |
| Hover cards | `shadow-diffuse` | Soft, premium feel |
| Buttons (hover) | `hover:shadow-sm` | Subtle lift |

---

## 6. Component Refactoring Guide

### Button Component

```typescript
// packages/ui/src/components/button.tsx

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Base styles - note the details
  `inline-flex items-center justify-center gap-2
   whitespace-nowrap rounded-lg
   text-base font-medium
   ring-offset-background
   transition-colors duration-200
   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
   disabled:pointer-events-none disabled:opacity-50
   [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0`,
  {
    variants: {
      variant: {
        default: "bg-foreground text-background hover:bg-foreground/90",
        destructive: "bg-background text-destructive border border-destructive/20 hover:bg-destructive/10",
        outline: "border border-input bg-background hover:bg-muted hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-muted hover:text-accent-foreground text-foreground/80",
        link: "text-foreground/70 hover:text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3 text-sm",
        lg: "h-11 px-8",
        icon: "h-10 w-10",
        iconSm: "h-7 w-7 [&_svg]:size-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);
```

**Key details that create polish:**
- `transition-colors duration-200` - Smooth color changes
- `hover:bg-foreground/90` - 10% opacity change, not jarring
- `[&_svg]:size-4` - Consistent icon sizing
- `ring-offset-background` - Focus ring respects theme

### Input Component

```typescript
// packages/ui/src/components/input.tsx

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          `flex h-10 w-full rounded-md
           bg-background px-3 py-2
           text-base
           ring-1 ring-border
           transition-all duration-200
           placeholder:text-muted-foreground
           focus:ring-2 focus:ring-special focus:outline-none
           disabled:cursor-not-allowed disabled:opacity-50`,
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
```

**Polish details:**
- `ring-1 ring-border` instead of `border` - Sharper, more modern
- `focus:ring-special` - Warm accent color on focus (the orange tone)
- `transition-all` - Smooth ring expansion

### Card Component

```typescript
// packages/ui/src/components/card.tsx

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        `rounded-xl border bg-card text-card-foreground shadow-sm`,
        className
      )}
      {...props}
    />
  )
);

const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col space-y-1.5 p-6", className)}
      {...props}
    />
  )
);

const CardTitle = React.forwardRef<HTMLParagraphElement, CardTitleProps>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        "text-xl font-semibold leading-none tracking-tight",
        className
      )}
      {...props}
    />
  )
);

const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  )
);
```

**Polish details:**
- `rounded-xl` - Larger radius for cards (20px)
- `shadow-sm` - Subtle elevation
- `space-y-1.5` - Tight but readable header spacing
- `p-6 pt-0` on content - Removes double padding

### Dialog Component

```typescript
// packages/ui/src/components/dialog.tsx

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      `fixed inset-0 z-50
       bg-black/40 backdrop-blur-sm
       data-[state=open]:animate-in
       data-[state=closed]:animate-out
       data-[state=closed]:fade-out-0
       data-[state=open]:fade-in-0`,
      className
    )}
    {...props}
  />
));

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        `fixed left-[50%] top-[50%] z-50
         w-full max-w-lg
         translate-x-[-50%] translate-y-[-50%]
         rounded-lg border bg-background p-6
         shadow-lg
         duration-200
         data-[state=open]:animate-in
         data-[state=closed]:animate-out
         data-[state=closed]:fade-out-0
         data-[state=open]:fade-in-0
         data-[state=closed]:zoom-out-95
         data-[state=open]:zoom-in-95
         data-[state=closed]:slide-out-to-left-1/2
         data-[state=closed]:slide-out-to-top-[48%]
         data-[state=open]:slide-in-from-left-1/2
         data-[state=open]:slide-in-from-top-[48%]`,
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
));
```

**Polish details:**
- `backdrop-blur-sm` - Glassmorphism effect
- `bg-black/40` - Semi-transparent overlay
- Full animation suite for open/close
- `zoom-out-95` / `zoom-in-95` - Subtle scale animation

### Badge Component

```typescript
// packages/ui/src/components/badge.tsx

const badgeVariants = cva(
  `inline-flex items-center rounded-full
   px-2 py-0.5
   text-xs font-medium
   font-mono tracking-wider uppercase
   border
   transition-colors`,
  {
    variants: {
      variant: {
        default: "border-transparent bg-foreground text-background",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border text-foreground hover:bg-muted",
        highlight: "bg-highlight text-highlight-foreground border-highlight-foreground/25",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);
```

**Polish details:**
- `font-mono tracking-wider uppercase` - Technical, label-like appearance
- `rounded-full` - Pill shape
- `border-highlight-foreground/25` - Subtle border on highlight variant

---

## 7. Micro-Interactions

### Hover States

Every interactive element needs a hover state:

```css
/* Standard opacity hover */
.interactive-default {
  @apply hover:bg-foreground/90;
}

/* Muted hover for secondary elements */
.interactive-muted {
  @apply hover:bg-muted hover:text-accent-foreground;
}

/* Destructive hover - background tint */
.interactive-destructive {
  @apply hover:bg-destructive/10;
}

/* Link hover */
.interactive-link {
  @apply hover:text-foreground hover:underline;
}
```

### Focus States

Consistent, accessible focus rings:

```css
.focus-ring {
  @apply focus-visible:outline-none
         focus-visible:ring-2
         focus-visible:ring-ring
         focus-visible:ring-offset-2
         focus-visible:ring-offset-background;
}

/* Special focus for inputs */
.focus-ring-special {
  @apply focus:ring-2 focus:ring-special focus:outline-none;
}
```

### Disabled States

```css
.disabled-state {
  @apply disabled:pointer-events-none
         disabled:opacity-50
         disabled:cursor-not-allowed;
}
```

### Loading States

```typescript
// Skeleton loader
const Skeleton = ({ className, ...props }) => (
  <div
    className={cn("animate-pulse rounded-md bg-muted", className)}
    {...props}
  />
);

// Retro spinner (Chorus style)
const RetroSpinner = () => {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return <span className="font-mono">{frames[frame]}</span>;
};
```

---

## 8. Scrollbar Customization

```css
/* packages/ui/src/styles/globals.css */

/* Custom scrollbar */
::-webkit-scrollbar {
  width: 7px;
  height: 7px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: hsl(var(--foreground) / 0.2);
  border-radius: 5px;
}

::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--foreground) / 0.4);
}

/* Utility classes */
.no-scrollbar::-webkit-scrollbar {
  display: none;
}

.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

/* Subtle scrollbar - only visible on hover */
.scrollbar-subtle::-webkit-scrollbar-thumb {
  background: transparent;
}

.scrollbar-subtle:hover::-webkit-scrollbar-thumb {
  background: hsl(var(--foreground) / 0.2);
}
```

---

## 9. Special Effects

### Shimmer Effect (for loading/highlighting)

```css
.shimmer {
  background: linear-gradient(
    to right,
    hsl(30, 47%, 63%) 0%,
    hsl(var(--foreground)) 40%,
    hsl(30, 47%, 63%) 100%
  );
  background-size: 200% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: shimmer 5s linear infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

### Glassmorphism Panel

```css
.glass-panel {
  background: hsl(var(--background) / 0.8);
  backdrop-filter: blur(12px);
  border: 1px solid hsl(var(--border) / 0.5);
}
```

### Synthesis Effect (for AI generation feedback)

```css
@keyframes synthesisPulse {
  0%, 20% {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
  80%, 100% {
    transform: translateY(25px) scale(0.6);
    opacity: 0;
  }
}

.synthesis-pulse {
  animation: synthesisPulse 1.5s ease-in-out infinite;
}
```

---

## 10. Implementation Checklist

### Phase 1: Foundation (Week 1)

- [ ] Update Tailwind config with new color system
- [ ] Add HSL color variables to globals.css
- [ ] Configure typography scale
- [ ] Set up border radius variables
- [ ] Add animation keyframes
- [ ] Configure shadow system

### Phase 2: Core Components (Week 2)

- [ ] Refactor Button component with variants
- [ ] Update Input with ring-based focus
- [ ] Refactor Card with proper spacing
- [ ] Update Dialog with animations and blur
- [ ] Add Badge component
- [ ] Update Switch component

### Phase 3: Interactions (Week 3)

- [ ] Add hover states to all interactive elements
- [ ] Implement consistent focus rings
- [ ] Add disabled states
- [ ] Create loading components (Skeleton, Spinner)
- [ ] Add transition classes everywhere

### Phase 4: Polish (Week 4)

- [ ] Custom scrollbars
- [ ] Glassmorphism effects where appropriate
- [ ] Shimmer effects for loading states
- [ ] Review all component spacing
- [ ] Dark mode audit
- [ ] Animation timing review

---

## 11. Quality Checklist

Before considering a component "Chorus-level polished":

### Visual
- [ ] Uses semantic colors (not hardcoded)
- [ ] Consistent border radius
- [ ] Appropriate shadow level
- [ ] Proper spacing (4px grid)

### Interactive
- [ ] Has hover state
- [ ] Has focus state (visible ring)
- [ ] Has disabled state
- [ ] Smooth transitions (200ms+)

### Accessible
- [ ] Focus visible for keyboard navigation
- [ ] Sufficient color contrast
- [ ] Proper ARIA attributes
- [ ] Works with screen readers

### Responsive
- [ ] Works on mobile
- [ ] Touch targets are large enough (44px min)
- [ ] Text is readable at all sizes

---

## 12. Common Mistakes to Avoid

### Don't

```typescript
// ❌ Hard-coded colors
className="bg-gray-100 text-gray-900"

// ❌ Missing transitions
className="bg-primary hover:bg-primary-dark"

// ❌ Inconsistent radius
className="rounded-md" // on one button
className="rounded-lg" // on another

// ❌ Missing focus states
className="outline-none" // removes accessibility!
```

### Do

```typescript
// ✅ Semantic colors
className="bg-muted text-foreground"

// ✅ With transitions
className="bg-primary hover:bg-primary/90 transition-colors duration-200"

// ✅ Consistent radius via variable
className="rounded-lg" // everywhere for buttons

// ✅ Proper focus handling
className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
```

---

## 13. File Reference

After refactoring, your structure should include:

```
packages/ui/
├── src/
│   ├── components/
│   │   ├── button.tsx          # CVA-based variants
│   │   ├── input.tsx           # Ring-based focus
│   │   ├── card.tsx            # Proper spacing
│   │   ├── dialog.tsx          # Animated with blur
│   │   ├── badge.tsx           # Pill variants
│   │   ├── switch.tsx          # Elevated thumb
│   │   ├── skeleton.tsx        # Loading state
│   │   └── ...
│   ├── styles/
│   │   └── globals.css         # Color system, scrollbars
│   └── lib/
│       └── utils.ts            # cn() function
├── tailwind.config.ts          # Full theme config
└── postcss.config.js
```

---

## Summary

The difference between a "good" UI and a "polished" UI is in the details:

1. **Color depth** - 11 shades instead of 3
2. **Timing** - 200ms transitions on everything
3. **Consistency** - Same radius, spacing, shadows everywhere
4. **Feedback** - Every interaction has visual response
5. **Subtlety** - 10% opacity changes, not 50%
6. **Blur** - Glassmorphism hints for depth
7. **Typography** - Letter-spacing on labels, proper weights

Apply these principles systematically and Superset will achieve Chorus-level polish.
