# Job Application Manager

A modern web application for managing job applications built with React and TypeScript.

## Tech Stack

- **Framework:** React 18
- **Language:** TypeScript
- **Build Tool:** Vite
- **Linting:** ESLint (TypeScript + React rules)
- **Formatting:** Prettier

## Project Structure

```
src/
├── components/    # Reusable UI components
├── pages/         # Page-level components
├── hooks/         # Custom React hooks
├── utils/         # Utility functions
├── types/         # TypeScript type definitions
├── services/      # API service layer
└── assets/        # Static assets (images, fonts, etc.)
```

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open [http://localhost:5173](http://localhost:5173) in your browser

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## Development Guidelines

### Code Style

- Follow TypeScript best practices
- Use functional components with hooks
- Keep components small and focused
- Write descriptive variable and function names
- Add comments for complex logic

### Formatting

Code formatting is enforced with Prettier. Configuration is in `.prettierrc`.

### Linting

ESLint is configured with TypeScript and React rules. The configuration includes:
- TypeScript recommended rules
- React Hooks rules
- React Refresh rules (Vite HMR)
- Prettier integration (no conflicting rules)

## Project Status

🚧 **In Development** - Project scaffolding complete. Waiting for:
- BA requirements ([WIC-15](/WIC/issues/WIC-15))
- UI/UX specifications ([WIC-16](/WIC/issues/WIC-16))
- Architecture and API contracts ([WIC-17](/WIC/issues/WIC-17))

## License

Proprietary - All rights reserved
