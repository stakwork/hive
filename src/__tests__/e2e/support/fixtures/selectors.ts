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
    capacityLink: '[data-testid="nav-capacity"]',
    recommendationsLink: '[data-testid="nav-recommendations"]',
    learnLink: '[data-testid="nav-learn"]',
    userJourneysLink: '[data-testid="nav-user-journeys"]',
    roadmapLink: '[data-testid="nav-plan"]',
    callsLink: '[data-testid="nav-calls"]',
    buildButton: '[data-testid="nav-build"]',
    protectButton: '[data-testid="nav-protect"]',
    contextButton: '[data-testid="nav-context"]',
  },

  // Page titles
  pageTitle: {
    element: '[data-testid="page-title"]',
    dashboard: '[data-testid="page-title"]:has-text("Dashboard")',
    tasks: '[data-testid="page-title"]:has-text("Tasks")',
    recommendations: '[data-testid="page-title"]:has-text("Recommendations")',
    settings: '[data-testid="page-title"]:has-text("Workspace Settings")',
    calls: '[data-testid="page-title"]:has-text("Calls")',
    capacity: '[data-testid="page-title"]:has-text("Capacity")',
  },

  // Page descriptions
  pageDescription: {
    element: '[data-testid="page-description"]',
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

  workspaceSettings: {
    nameInput: '[data-testid="workspace-settings-name-input"]',
    slugInput: '[data-testid="workspace-settings-slug-input"]',
    descriptionInput: '[data-testid="workspace-settings-description-input"]',
    saveButton: '[data-testid="workspace-settings-save-button"]',
  },

  workspaceDeletion: {
    card: '[data-testid="delete-workspace-card"]',
    deleteButton: '[data-testid="delete-workspace-button"]',
    dialog: '[data-testid="delete-workspace-dialog"]',
    confirmationInput: '[data-testid="delete-workspace-confirmation-input"]',
    cancelButton: '[data-testid="delete-workspace-cancel-button"]',
    confirmButton: '[data-testid="delete-workspace-confirm-button"]',
  },

  workspaceMembers: {
    card: '[data-testid="workspace-members-card"]',
    addButton: '[data-testid="add-member-button"]',
    emptyState: '[data-testid="members-empty-state"]',
    ownerRow: '[data-testid="workspace-owner-row"]',
    memberRow: '[data-testid="workspace-member-row"]',
    roleBadge: '[data-testid="member-role-badge"]',
    actionsButton: '[data-testid="member-actions-button"]',
    actionMakeAdmin: '[data-testid="member-action-make-admin"]',
    actionMakePM: '[data-testid="member-action-make-pm"]',
    actionMakeDeveloper: '[data-testid="member-action-make-developer"]',
    actionMakeViewer: '[data-testid="member-action-make-viewer"]',
    actionRemove: '[data-testid="member-action-remove"]',
  },

  addMemberModal: {
    modal: '[data-testid="add-member-modal"]',
    form: '[data-testid="add-member-form"]',
    githubInput: '[data-testid="add-member-github-input"]',
    roleTrigger: '[data-testid="add-member-role-trigger"]',
    roleOptionViewer: '[data-testid="role-option-viewer"]',
    roleOptionDeveloper: '[data-testid="role-option-developer"]',
    roleOptionPm: '[data-testid="role-option-pm"]',
    roleOptionAdmin: '[data-testid="role-option-admin"]',
    submit: '[data-testid="add-member-submit"]',
    cancel: '[data-testid="add-member-cancel"]',
  },

  dialogs: {
    confirm: '[data-testid="remove-member-dialog"]',
    confirmButton: '[data-testid="remove-member-dialog-confirm"]',
    cancelButton: '[data-testid="remove-member-dialog-cancel"]',
  },

  // Tasks
  tasks: {
    newTaskButton: 'button:has-text("New Task")',
    taskStartInput: '[data-testid="task-start-input"]',
    taskStartSubmit: '[data-testid="task-start-submit"]',
    chatMessageInput: '[data-testid="chat-message-input"]',
    chatMessageSubmit: '[data-testid="chat-message-submit"]',
    taskTitle: '[data-testid="task-title"]',
    taskCard: '[data-testid="task-card"]',
    launchPodsButton: 'button:has-text("Launch Pods")',
    taskListContainer: '[data-testid="task-card"]',
    recentTasksHeading: 'text=/Recent Tasks|Tasks/i',
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

  // Recommendations
  recommendations: {
    card: '[data-testid="recommendation-card"]',
    title: '[data-testid="recommendation-title"]',
    description: '[data-testid="recommendation-description"]',
    impact: '[data-testid="recommendation-impact"]',
    reviewBadge: '[data-testid="recommendation-review-badge"]',
    acceptButton: '[data-testid="recommendation-accept-button"]',
    dismissButton: '[data-testid="recommendation-dismiss-button"]',
  },

  // Onboarding
  onboarding: {
    welcomeText: 'text=/Welcome|Get Started|Create.*Workspace/i',
    nextButton: 'button:has-text("Next"), button:has-text("Continue")',
    backButton: 'button:has-text("Back"), button:has-text("Previous")',
    nameInput: 'input[name="name"], input[placeholder*="workspace" i]',
    createButton: 'button:has-text("Create")',
  },

  // Roadmap & Features
  roadmap: {
    featureInput: '[data-testid="feature-title-input"]',
    featureCard: '[data-testid="feature-card"]',
    addFeatureButton: '[data-testid="add-feature-button"]',
  },

  feature: {
    briefInput: '[data-testid="feature-brief-input"]',
    requirementsInput: '[data-testid="feature-requirements-input"]',
    architectureInput: '[data-testid="feature-architecture-input"]',
    userStoryInput: '[data-testid="user-story-input"]',
    addUserStoryButton: '[data-testid="add-user-story-button"]',
    phaseInput: '[data-testid="phase-name-input"]',
    addPhaseButton: '[data-testid="add-phase-button"]',
    phaseCard: '[data-testid="phase-card"]',
  },

  phase: {
    ticketInput: '[data-testid="ticket-title-input"]',
    addTicketButton: '[data-testid="add-ticket-button"]',
    ticketRow: '[data-testid="ticket-row"]',
  },

  // Calls
  calls: {
    startCallButton: 'button:has-text("Start Call")',
    callRecordingsCard: 'text=/Call Recordings/i',
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

  workspaceMemberRowByUsername: (username: string) =>
    `[data-testid="workspace-member-row"][data-member-username="${username}"]`,

  workspaceMemberRoleBadgeByUsername: (username: string) =>
    `[data-testid="workspace-member-row"][data-member-username="${username}"] [data-testid="member-role-badge"]`,
};
