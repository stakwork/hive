/**
 * Common selectors used across E2E tests
 * Centralizes selector logic to reduce duplication and improve maintainability
 */

export const selectors = {
  // Authentication
  auth: {
    mockSignInButton: '[data-testid="mock-signin-button"]',
    githubSignInButton: '[data-testid="github-signin-button"]',
    welcomeMessage: 'div.grid.auto-rows-min.items-start:has-text("Welcome to Hive")',
  },

  // Navigation
  navigation: {
    settingsButton: '[data-testid="settings-button"]',
    tasksLink: '[data-testid="nav-tasks"]',
    dashboardLink: '[data-testid="nav-dashboard"]',
    insightsLink: '[data-testid="nav-insights"]',
    learnLink: '[data-testid="nav-learn"]',
    userJourneysLink: '[data-testid="nav-user-journeys"]',
  },

  // Page titles
  pageTitle: {
    element: '[data-testid="page-title"]',
    dashboard: '[data-testid="page-title"]:has-text("Dashboard")',
    tasks: '[data-testid="page-title"]:has-text("Tasks")',
    insights: '[data-testid="page-title"]:has-text("Insights")',
    settings: '[data-testid="page-title"]:has-text("Workspace Settings")',
  },

  // Workspace
  workspace: {
    switcher: 'button', // Will be filtered by workspace name
    nameInput: 'input.border-input.flex.h-9',
    slugInput: 'input.border-input.flex.h-9',
    descriptionTextarea: 'textarea.border-input.flex.field-sizing-content',
    updateButton: 'button:has-text("Update Workspace")',
    createButton: 'button:has-text("Create")',
  },

  // Tasks
  tasks: {
    newTaskButton: 'button:has-text("New Task")',
    taskInput: 'textarea',
    submitButton: 'button[type="submit"], button:has-text("Send")',
    taskCard: '[data-testid="task-card"]',
    connectRepoButton: 'button:has-text("Connect Repository")',
  },

  // Dashboard
  dashboard: {
    vmSection: '[data-testid="vm-config-section"]',
    repoSection: '[data-testid="repository-card"]',
    coverageSection: '[data-testid="coverage-card"]',
    recentTasksSection: 'text=/Recent Tasks|No tasks yet/i',
  },

  // Insights
  insights: {
    coverageCard: 'text=/Test Coverage|Coverage/i',
    testingSection: 'text=/Testing/i',
    securitySection: 'text=/Security/i',
    maintainabilitySection: 'text=/Maintainability/i',
    recommendationsSection: 'text=/Recommendations|Recent/i',
    unitTestJanitor: 'text=/Unit Tests|Unit Testing/i',
    integrationTestJanitor: 'text=/Integration Tests|Integration Testing/i',
    comingSoonBadge: 'text=/Coming Soon|Disabled/i',
    toggleButton: 'button[role="switch"], input[type="checkbox"]',
    acceptButton: 'button:has-text("Accept"), button[aria-label*="accept" i]',
    dismissButton: 'button:has-text("Dismiss"), button[aria-label*="dismiss" i]',
  },

  // Onboarding
  onboarding: {
    welcomeText: 'text=/Welcome|Get Started|Create.*Workspace/i',
    nextButton: 'button:has-text("Next"), button:has-text("Continue")',
    backButton: 'button:has-text("Back"), button:has-text("Previous")',
    nameInput: 'input[name="name"], input[placeholder*="workspace" i]',
    createButton: 'button:has-text("Create")',
  },

  // Common UI elements
  common: {
    loader: 'text=/Loading/i',
    errorMessage: 'text=/error|failed/i',
    successMessage: 'text=/success|complete/i',
    modalOverlay: '[role="dialog"], .modal',
    closeButton: 'button[aria-label="Close"], button:has-text("Close")',
  },
};

/**
 * Helper to build dynamic selectors
 */
export const dynamicSelectors = {
  /**
   * Select workspace switcher by workspace name
   */
  workspaceSwitcher: (workspaceName: string) =>
    `button:has-text("${workspaceName}")`,

  /**
   * Select task by title
   */
  taskByTitle: (title: string) =>
    `text="${title}"`,

  /**
   * Select page by title
   */
  pageTitle: (title: string) =>
    `h1:has-text("${title}")`,

  /**
   * Select button by text
   */
  buttonByText: (text: string) =>
    `button:has-text("${text}")`,

  /**
   * Select link by text
   */
  linkByText: (text: string) =>
    `a:has-text("${text}")`,
};
