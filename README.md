# Hive Platform

Hive Platform is an AI-first product development platform that helps teams solve enterprise codebase challenges, visualize complex systems, and accelerate development through intelligent automation and secure authentication.

## 🚀 Features

- **🔐 Secure Authentication**: Lightning Network-based authentication via Sphinx Chat
- **🤖 AI-Powered Development**: Intelligent automation for codebase analysis and task management
- **📋 Smart Task Management**: AI-driven task prioritization and estimation
- **🗺️ System Visualization**: Visualize complex enterprise systems and dependencies
- **💰 Bounty System**: Accelerate delivery with integrated bounty and reward system
- **👥 Team Collaboration**: Real-time collaboration with role-based permissions
- **📊 Analytics & Insights**: Track progress and get predictive insights

## 🏗️ Architecture

### Frontend

- **Framework**: Next.js 15 with App Router and Turbopack
- **Styling**: Tailwind CSS v4
- **UI Components**: shadcn/ui with Radix UI primitives
- **TypeScript**: Full type safety
- **Forms**: React Hook Form + Zod validation
- **State Management**: React Query for server state

### Backend

- **API Routes**: Next.js API routes for serverless functions
- **Database**: PostgreSQL with Prisma ORM
- **Validation**: Zod schemas for type-safe API requests
- **Authentication**: Sphinx Chat integration with JWT tokens
- **Error Tracking**: Sentry integration

### Database Schema

- **Users**: Lightning Network users with Sphinx authentication
- **Auth Challenges**: Secure authentication flow management
- **Projects**: Product initiatives and their metadata
- **Tasks**: Individual work items with AI-powered insights
- **Bounties**: Reward-based task completion system

## 🛠️ Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS v4, shadcn/ui
- **Backend**: Next.js API Routes, Prisma ORM, PostgreSQL
- **Authentication**: Sphinx Chat, JWT tokens, Lightning Network
- **Validation**: Zod
- **Forms**: React Hook Form
- **State Management**: TanStack React Query
- **Error Tracking**: Sentry
- **Testing**: Vitest, Testing Library
- **Deployment**: Docker, Vercel (recommended)

## 📦 Installation

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Sphinx Chat desktop app (for authentication)

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

```bash
cp env.example .env.local
```

Edit `.env.local` with your configuration:

```env
DATABASE_URL="postgresql://hive_user:hive_password@localhost:5432/hive_db"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key-here"
JWT_SECRET="your-64-character-hex-secret-here"

# GitHub OAuth (for Code Graph feature)
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"
```

4. **Generate JWT secret (optional)**

```bash
npm run setup
```

5. **Set up the database**

`docker-compose up -d postgres`

```bash
# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev
```

6. **Start the development server**

```bash
npm run dev
```

7. **Open your browser**

Navigate to [http://localhost:3000](http://localhost:3000)

## 🔐 Authentication

Hive uses Sphinx Chat for secure Lightning Network-based authentication:

1. **Install Sphinx Chat**: Download from [sphinx.chat](https://sphinx.chat)
2. **Login Process**:
   - Click "Login with Sphinx" on the login page
   - The app will automatically open Sphinx Chat
   - Approve the authentication request in Sphinx
   - You'll be automatically logged in

### Development Authentication

In development mode, you can use a quick test login bypass for faster development cycles.

## 🔗 GitHub OAuth Setup

The Code Graph feature requires GitHub OAuth integration for repository access:

### 1. Create GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in the application details:
   - **Application name**: Hive Platform
   - **Homepage URL**: `http://localhost:3000` (development) or your production URL
   - **Authorization callback URL**: `http://localhost:3000/api/auth/callback/github` (development) or `https://yourdomain.com/api/auth/callback/github` (production)
4. Click "Register application"
5. Copy the **Client ID** and **Client Secret**

### 2. Configure Environment Variables

Add your GitHub OAuth credentials to `.env.local`:

```env
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"
```

### 3. Permissions

The OAuth app requests the following scopes:

- `repo` - Access to public and private repositories
- `read:org` - Read organization information

### 4. Testing the Integration

1. Navigate to the Code Graph page (`/codegraph`)
2. Click "Connect with GitHub"
3. Authorize the application in GitHub
4. Select organizations and repositories to analyze

## 🐳 Docker Setup

For containerized deployment, see [DOCKER.md](./DOCKER.md) for detailed instructions.

### Quick Docker Start

```bash
# Development
docker-compose -f docker-compose.dev.yml up --build

# Production
docker-compose up --build
```

## 📁 Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes
│   │   └── auth/          # Authentication endpoints
│   │       ├── ask/       # Generate auth challenges
│   │       ├── poll/      # Check auth status
│   │       ├── verify/    # Verify authentication
│   │       └── verify-token/ # Token validation
│   ├── dashboard/         # Dashboard page
│   ├── login/             # Authentication page
│   ├── tasks/             # Task management
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page
├── components/            # React components
│   ├── auth/             # Authentication components
│   │   └── SphinxLogin.tsx # Sphinx authentication
│   ├── ui/               # shadcn/ui components
│   ├── layout/           # Layout components
│   └── dashboard/        # Dashboard-specific components
├── lib/                  # Utility functions
│   ├── auth.ts          # Authentication utilities
│   ├── db.ts            # Database client
│   ├── utils.ts         # General utilities
│   └── validations.ts   # Zod schemas
├── providers/           # React context providers
│   └── AuthProvider.tsx # Authentication state
└── generated/           # Generated Prisma client
```

## 🔧 Development

### Available Scripts

- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run setup` - Generate JWT secret

### Database Commands

- `npx prisma studio` - Open Prisma Studio (database GUI)
- `npx prisma migrate dev` - Create and apply migrations
- `npx prisma generate` - Generate Prisma client
- `npx prisma db push` - Push schema changes to database

### Adding New Components

```bash
# Add shadcn/ui components
npx shadcn@latest add [component-name]

# Examples:
npx shadcn@latest add table
npx shadcn@latest add dialog
npx shadcn@latest add dropdown-menu
```

## 🚀 Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Connect your repository to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy automatically on push

### Docker Deployment

See [DOCKER.md](./DOCKER.md) for detailed Docker deployment instructions.

### Environment Variables for Production

- `DATABASE_URL` - Production PostgreSQL connection string
- `NEXTAUTH_URL` - Your production domain
- `NEXTAUTH_SECRET` - Secure random string for session encryption
- `JWT_SECRET` - 64-character hex string for JWT signing

## 🔮 Roadmap

### Phase 1: Core Platform ✅

- [x] Sphinx authentication integration
- [x] User management with Lightning Network
- [x] Basic dashboard and analytics
- [x] Docker containerization

### Phase 2: AI Integration 🚧

- [ ] AI-powered codebase analysis
- [ ] Smart task estimation and prioritization
- [ ] Automated system visualization
- [ ] Predictive development insights

### Phase 3: Advanced Features 📋

- [ ] Real-time collaboration tools
- [ ] Advanced bounty marketplace
- [ ] Integration with external development tools
- [ ] Mobile app development

### Phase 4: Enterprise Features 🏢

- [ ] Advanced permissions and roles
- [ ] SSO integration
- [ ] Advanced analytics and reporting
- [ ] API for third-party integrations

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

- **Documentation**: Check the docs folder for detailed guides
- **Issues**: Report bugs and feature requests via GitHub Issues
- **Discussions**: Join community discussions on GitHub Discussions

---

Built with ❤️ by the Hive Platform team
