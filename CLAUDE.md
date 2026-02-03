# AI Canvas

AI design tool web application - "Imagine it. Design it."

## Project Overview

A frontend web application for AI-powered image and design generation. Users can input creative ideas or upload images to generate AI-designed content.

## Tech Stack

- **HTML5** - Semantic markup with accessibility attributes (aria-labels)
- **CSS3** - CSS custom properties (variables), Flexbox, Grid, animations
- **Vanilla JavaScript** - No frameworks, ES6+ features
- **Fonts** - Google Fonts (Inter, Playfair Display)

## Project Structure

```
AI Canvas/
├── index.html          # Main HTML page
├── styles.css          # All styles with CSS variables design system
├── script.js           # Application logic and interactivity
└── assets/
    └── images/         # Hero images (hero-1.png through hero-4.png)
```

## Key Features

- **Hero Section** - Floating animated images showcasing designs
- **Creation Input** - Text input with file upload (drag & drop supported)
- **Tool Categories** - Category chips for filtering AI tools
- **Recent Projects** - Grid of recent user projects
- **Inspiration Gallery** - Masonry-style grid with filterable tabs
- **Modal System** - Image preview modal
- **Loading Overlay** - Progress indicator for AI generation
- **Toast Notifications** - Feedback messages

## CSS Design System

CSS variables are defined in `:root` for consistent theming:

- Colors: `--color-bg-primary`, `--color-primary`, etc.
- Spacing: `--spacing-xs` through `--spacing-2xl`
- Border radius: `--radius-sm` through `--radius-full`
- Shadows: `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-glow`
- Transitions: `--transition-fast`, `--transition-base`, `--transition-slow`

## JavaScript Architecture

- Global state variables at top of file
- Event listeners initialized on DOMContentLoaded
- Functions organized by feature section (Header, Creation, Projects, etc.)
- No external dependencies

## Development Notes

- Dark theme by default (background: #0a0b0e)
- Responsive breakpoints at 768px and 480px
- Images from Unsplash for inspiration gallery (external URLs)
- Simulated AI generation with progress bar animation
- Free usage counter (10/10) with visual warning at low count

## Running Locally

Open `index.html` directly in a browser - no build step required.
