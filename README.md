# Hive Platform

Hive Platform is a modern, workspace-based product development platform that helps teams manage complex projects through AI-powered collaboration, code graph visualization, and intelligent task management. Built with Next.js and powered by a sophisticated multi-tenant workspace architecture.

## 🚀 Features

- **🏢 Multi-Tenant Workspaces**: Role-based workspace management with fine-grained permissions
- **🔐 GitHub Authentication**: Secure OAuth integration with GitHub for seamless code repository access
- **🤖 AI-Powered Chat**: Intelligent task management with artifact generation and code assistance
- **📊 Stakgraph Integration**: Visualize and manage complex system architectures with AI-powered insights
- **🗺️ Product Roadmaps**: Comprehensive feature planning with requirements and user story management
- **⚡ Swarm Infrastructure**: Automated deployment and environment management
- **📋 Task Management**: Full-featured task system with comments, assignments, and status tracking
- **🔄 Real-time Collaboration**: Live updates and synchronized workspace state

## 🏗️ Architecture

### Tech Stack

- **Frontend**: Next.js 15 with App Router, React 19, TypeScript
- **Styling**: Tailwind CSS v4, shadcn/ui components with Radix UI
- **Backend**: Next.js API routes, Prisma ORM, PostgreSQL
- **Authentication**: NextAuth.js with GitHub OAuth
- **State Management**: Zustand for client state, TanStack React Query for server state
- **Real-time**: Pusher for WebSocket connections
- **Testing**: Vitest with Testing Library
- **Forms**: React Hook Form + Zod validation

### Database Schema

The application follows a hierarchical multi-tenant structure:

- **Users & Authentication**: NextAuth.js integration with GitHub OAuth
- **Workspaces**: Role-based multi-tenant workspace system
- **Infrastructure**: Swarms (deployment infrastructure) and repositories
- **Product Management**: Products → Features → User Stories → Tasks hierarchy
- **Roadmap Management**: Time-based planning with dependencies
- **Communication**: Polymorphic comment system and chat integration

### Permission System

Role hierarchy (from highest to lowest access):
- `OWNER` - Full workspace control and management
- `ADMIN` - User management, settings, and repository access
- `PM` - Product management, features, and roadmap control
- `DEVELOPER` - Development tasks and content creation
- `STAKEHOLDER` - Limited content interaction and visibility
- `VIEWER` - Read-only access to workspace content

## 📦 Installation

### Prerequisites

- Node.js 18+
- PostgreSQL database
- GitHub OAuth application

### Quick Start

1. **Clone the repository**

```bash
git clone <your-repo-url>
cd hive
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

Create a `.env.local` file in the root directory:

```env
# Database
DATABASE_URL="postgresql://hive_user:hive_password@localhost:5432/hive_db"

# NextAuth.js
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key-here"

# GitHub OAuth (Required)
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"

# Optional: Development mock authentication
POD_URL="http://localhost:3000"  # Enables mock login for development

# Optional: External API keys
STAKWORK_API_KEY="your-stakwork-api-key"
```

4. **Generate development secrets**

```bash
npm run setup
```

5. **Set up the database**

Start PostgreSQL (or use Docker):
```bash
docker-compose up -d postgres
```

Run database migrations:
```bash
npx prisma generate
npx prisma migrate dev
```

6. **Start the development server**

```bash
npm run dev
```

7. **Open your browser**

Navigate to [http://localhost:3000](http://localhost:3000)

## 🔐 Authentication

### GitHub OAuth Setup

1. **Create GitHub OAuth App**
   - Go to [GitHub Developer Settings](https://github.com/settings/developers)
   - Click "New OAuth App"
   - Set **Homepage URL**: `http://localhost:3000` (development)
   - Set **Authorization callback URL**: `http://localhost:3000/api/auth/callback/github`
   - Copy the Client ID and Client Secret

2. **Required OAuth Scopes**
   - `read:user` - Access user profile information
   - `user:email` - Access user email addresses
   - `read:org` - Read organization membership
   - `repo` - Access public and private repositories

### Development Authentication

For faster development cycles, set `POD_URL` in your environment to enable mock authentication alongside GitHub OAuth.

## 📁 Project Structure

```
src/
├── app/                      # Next.js App Router
│   ├── api/                 # API routes
│   │   ├── auth/           # NextAuth.js endpoints
│   │   ├── github/         # GitHub integration
│   │   ├── stakwork/       # Stakwork API integration
│   │   ├── pool-manager/   # Pool management
│   │   ├── swarm/          # Swarm management
│   │   ├── tasks/          # Task management
│   │   └── workspaces/     # Workspace operations
│   ├── auth/               # Authentication pages
│   ├── onboarding/         # User onboarding flow
│   ├── w/[slug]/          # Workspace-specific pages
│   │   ├── code-graph/    # Code visualization
│   │   ├── roadmap/       # Product roadmaps
│   │   ├── settings/      # Workspace settings
│   │   ├── stakgraph/     # Stakgraph configuration
│   │   ├── task/          # AI chat interface
│   │   └── tasks/         # Task management
│   └── workspaces/         # Workspace selection
├── components/              # React components
│   ├── ui/                 # shadcn/ui components
│   ├── stakgraph/          # Stakgraph form components
│   ├── roadmap/            # Roadmap management
│   ├── onboarding/         # Onboarding components
│   └── wizard/             # Multi-step wizards
├── hooks/                   # React hooks
│   ├── useWorkspace.ts     # Workspace operations
│   ├── useWorkspaceAccess.ts # Permission checks
│   └── [other hooks]       # Feature-specific hooks
├── lib/                     # Core utilities
│   ├── auth/               # Authentication utilities
│   ├── db.ts               # Prisma client
│   └── utils.ts            # General utilities
├── services/                # External API services
│   ├── pool-manager/       # Pool Manager integration
│   ├── stakwork/           # Stakwork API
│   └── swarm/              # Swarm management
├── stores/                  # Zustand state stores
├── types/                   # TypeScript definitions
└── contexts/                # React contexts
```

## 🔧 Development

### Available Scripts

- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run setup` - Generate JWT secret

### Testing

- `npm run test` - Run all tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage
- `npm run test:unit` - Run unit tests only
- `npm run test:integration` - Run integration tests

### Database Management

- `npx prisma studio` - Open Prisma Studio (database GUI)
- `npx prisma migrate dev` - Create and apply migrations
- `npx prisma generate` - Generate Prisma client
- `npx prisma db push` - Push schema changes to database

### Test Database

- `npm run test:db:start` - Start test database
- `npm run test:db:stop` - Stop test database
- `npm run test:db:setup` - Setup test database
- `npm run test:db:reset` - Reset test database

### Adding New Components

```bash
# Add shadcn/ui components
npx shadcn@latest add [component-name]

# Examples:
npx shadcn@latest add table
npx shadcn@latest add dialog
npx shadcn@latest add dropdown-menu
```

### Working with Workspaces

- All workspace pages use the `/w/[slug]/*` URL pattern
- Use `useWorkspace()` hook for workspace data and operations
- Use `useWorkspaceAccess()` hook for permission checks
- Workspace context is provided by `WorkspaceProvider`

## 🐳 Docker Deployment

### Quick Docker Start

```bash
# Development
docker-compose -f docker-compose.dev.yml up --build

# Production
docker-compose up --build
```

### Production Environment Variables

```env
DATABASE_URL="postgresql://username:password@host:5432/database"
NEXTAUTH_URL="https://yourdomain.com"
NEXTAUTH_SECRET="secure-random-string-for-session-encryption"
GITHUB_CLIENT_ID="your-production-github-client-id"
GITHUB_CLIENT_SECRET="your-production-github-client-secret"
STAKWORK_API_KEY="your-stakwork-api-key"
```

## 🚀 Key Features Deep Dive

### Stakgraph Integration

Stakgraph provides AI-powered code analysis and system visualization:

- **Repository Integration**: Connect GitHub repositories for analysis
- **Swarm Management**: Automated deployment infrastructure
- **Environment Configuration**: Flexible environment variable management
- **Service Discovery**: Automatic service detection and configuration

### AI-Powered Task Management

- **Intelligent Chat Interface**: Contextual AI assistance for development tasks
- **Artifact Generation**: Automatic code, form, and documentation generation
- **Task Context**: AI understands project context and requirements
- **Real-time Collaboration**: Live updates and synchronized conversations

### Multi-Tenant Workspaces

- **Role-Based Access**: Granular permissions for team collaboration
- **Resource Isolation**: Complete data separation between workspaces
- **Flexible Membership**: Easy team member management and role assignment
- **Audit Trail**: Complete history of changes and user actions

## 🔮 Roadmap

### Current Version
- ✅ Multi-tenant workspace architecture
- ✅ GitHub OAuth integration
- ✅ Basic stakgraph configuration
- ✅ AI chat interface with artifacts
- ✅ Product roadmap management

### Upcoming Features
- 🚧 Enhanced code graph visualization
- 🚧 Advanced swarm orchestration
- 🚧 Real-time collaborative editing
- 🚧 Mobile application
- 📋 Advanced analytics and insights
- 📋 Third-party integrations (Slack, Discord)
- 📋 SSO and enterprise authentication

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow the existing code style and patterns
- Write tests for new features
- Update documentation as needed
- Use TypeScript strictly
- Follow the workspace-based architecture patterns

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

- **Documentation**: Check the `CLAUDE.md` file for detailed development guidance
- **Issues**: Report bugs and feature requests via GitHub Issues
- **Discussions**: Join community discussions on GitHub Discussions

---

Built with ❤️ by the Hive Platform team