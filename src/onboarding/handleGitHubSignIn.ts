import * as authService from '../services/authService';
import * as sessionService from '../services/sessionService';
import * as redirectUtils from '../utils/redirect';

interface GitHubSignInParams {
  code: string;
  state: string;
}

interface GitHubSignInSuccess {
  success: true;
  user: {
    id: string;
    login: string;
    email: string;
    name: string;
    avatar_url: string;
    isExistingUser?: boolean;
  };
  session: {
    id: string;
    userId: string;
    accessToken: string;
    expiresAt: Date;
  };
}

interface GitHubSignInError {
  success: false;
  error: string;
  errorType: 'AUTHENTICATION_ERROR' | 'SESSION_ERROR' | 'NETWORK_ERROR' | 'CSRF_ERROR' | 'VALIDATION_ERROR' | 'RATE_LIMIT_ERROR' | 'ACCESS_DENIED_ERROR' | 'SERVICE_UNAVAILABLE_ERROR' | 'TIMEOUT_ERROR';
}

type GitHubSignInResult = GitHubSignInSuccess | GitHubSignInError;

export async function handleGitHubSignIn(params: GitHubSignInParams): Promise<GitHubSignInResult> {
  const { code, state } = params;

  // Input validation
  if (code === null || code === undefined || state === null || state === undefined) {
    return {
      success: false,
      error: 'Invalid parameters provided',
      errorType: 'VALIDATION_ERROR'
    };
  }

  if (!code || code.trim() === '') {
    return {
      success: false,
      error: 'Missing authorization code',
      errorType: 'VALIDATION_ERROR'
    };
  }

  if (!state || state.trim() === '') {
    return {
      success: false,
      error: 'Missing state parameter',
      errorType: 'VALIDATION_ERROR'
    };
  }

  // Update user state to "authenticating"
  sessionService.updateUserState('authenticating');

  try {
    // Authenticate with GitHub
    const authResult = await authService.authenticateWithGitHub(code, state);
    
    // Create session
    const session = await sessionService.createSession({
      userId: authResult.user.id,
      accessToken: authResult.accessToken,
      provider: 'github'
    });

    // Update user state to "authenticated"
    sessionService.updateUserState('authenticated');

    return {
      success: true,
      user: authResult.user,
      session: session
    };

  } catch (error: any) {
    // Update user state to "error"
    sessionService.updateUserState('error');

    // Handle different error types
    let errorType: GitHubSignInError['errorType'] = 'AUTHENTICATION_ERROR';
    
    if (error.name === 'NetworkError') {
      errorType = 'NETWORK_ERROR';
    } else if (error.name === 'CSRFError') {
      errorType = 'CSRF_ERROR';
    } else if (error.name === 'RateLimitError') {
      errorType = 'RATE_LIMIT_ERROR';
    } else if (error.name === 'AccessDeniedError') {
      errorType = 'ACCESS_DENIED_ERROR';
    } else if (error.name === 'ServiceUnavailableError') {
      errorType = 'SERVICE_UNAVAILABLE_ERROR';
    } else if (error.name === 'TimeoutError') {
      errorType = 'TIMEOUT_ERROR';
    } else if (error.message && error.message.includes('session')) {
      errorType = 'SESSION_ERROR';
    }

    return {
      success: false,
      error: error.message || 'Authentication failed',
      errorType: errorType
    };
  }
}
