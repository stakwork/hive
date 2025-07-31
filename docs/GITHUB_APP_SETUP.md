# GitHub App Setup Guide

This guide explains how to set up a GitHub App for repository-specific permissions in your application.

## Why GitHub App vs OAuth?

- **OAuth**: Provides user-level permissions across all repositories the user has access to
- **GitHub App**: Provides fine-grained, repository-specific permissions that users can control

## Creating a GitHub App

1. **Go to GitHub App Settings**
   - Visit: https://github.com/settings/apps
   - Click "New GitHub App"

2. **Basic Information**
   - **GitHub App name**: Choose a unique name (e.g., "YourApp Code Graph")
   - **Description**: "Fine-grained repository access for code analysis"
   - **Homepage URL**: Your application's homepage
   - **Callback URL**: `https://yourdomain.com` (not used for installation flow)

3. **Webhook Configuration**
   - **Webhook URL**: Leave empty for now (optional)
   - **Webhook secret**: Leave empty (optional)

4. **Repository Permissions** (Set these to the minimum required)
   - **Contents**: Read & Write (to access and modify repository files)
   - **Metadata**: Read (to access basic repository information)
   - **Pull requests**: Read & Write (to create and manage PRs)
   - **Issues**: Read (optional, for issue integration)

5. **Account Permissions**
   - Leave all as "No access" unless specifically needed

6. **Subscribe to Events**
   - Optionally subscribe to relevant events like:
     - Push
     - Pull request
     - Issues (if using)

7. **Installation**
   - **Where can this GitHub App be installed?**: 
     - Choose "Any account" for public apps
     - Choose "Only on this account" for private apps

## After Creating the App

1. **Generate a Private Key**
   - In your app settings, scroll down to "Private keys"
   - Click "Generate a private key"
   - Download the `.pem` file

2. **Get Your App Details**
   - **App ID**: Found at the top of your app settings page
   - **Client ID**: Found in the app settings
   - **Client Secret**: Generate one in the app settings

3. **Get the App Slug**
   - The slug is the URL-friendly version of your app name
   - Example: "YourApp Code Graph" becomes "yourapp-code-graph"
   - You can find this in the URL when viewing your app

## Environment Variables

Add these to your `.env` file:

```bash
# GitHub App Integration (for repo-specific permissions)
GITHUB_APP_ID="123456"
GITHUB_APP_PRIVATE_KEY="LS0tLS1CRUdJTi..." # Base64 encoded content of the .pem file
GITHUB_APP_CLIENT_ID="Iv1.abc123def456"
GITHUB_APP_CLIENT_SECRET="your-client-secret"
GITHUB_APP_SLUG="yourapp-code-graph"
```

### Encoding the Private Key

The private key needs to be base64 encoded for the environment variable:

```bash
# On macOS/Linux:
base64 -i your-app-private-key.pem

# On Windows (PowerShell):
[Convert]::ToBase64String([IO.File]::ReadAllBytes("your-app-private-key.pem"))
```

Copy the entire output (it will be very long) and use it as the `GITHUB_APP_PRIVATE_KEY` value.

## How It Works

1. **Repository Selection**: When a user selects a repository in your app, the system checks if your GitHub App has access to that repository.

2. **App Not Installed**: If the app isn't installed on the user's account, they'll get a link to install it.

3. **App Installed but No Repo Access**: If the app is installed but doesn't have access to the specific repository, they'll get a link to grant repository access.

4. **App Linked**: Once the repository is linked, the user can continue with their workflow.

## API Endpoints

### Check GitHub App Integration

**POST** `/api/github/app-integration`

Request body:
```json
{
  "repositoryId": "123456789",
  "repositoryName": "my-repo",
  "repositoryOwner": "username"
}
```

Response (linked):
```json
{
  "status": "linked",
  "installationId": 12345,
  "message": "Repository is already linked to the GitHub App"
}
```

Response (not linked):
```json
{
  "status": "not_linked",
  "installationUrl": "https://github.com/apps/yourapp/installations/new",
  "message": "App needs to be installed on this account",
  "installationId": null
}
```

## User Flow

1. User selects a repository in your application
2. System automatically checks if the GitHub App has access
3. If not linked:
   - User sees a "Link GitHub App" button
   - Clicking opens the GitHub installation/permission page
   - User grants permissions and returns to your app
   - System re-checks and updates the status
4. Once linked, user can continue with their workflow

## Troubleshooting

### "GitHub App credentials not configured"
- Ensure all environment variables are set correctly
- Verify the private key is properly base64 encoded

### "GitHub token expired or invalid"
- The JWT token has a 10-minute expiration and is auto-generated
- If this persists, check your private key encoding

### "App is not installed on any accounts"
- The user needs to install your GitHub App on their account first
- Use the provided installation URL

### Repository not showing as accessible
- Check that your app has the correct permissions
- Verify the user granted access to the specific repository
- The user might need to modify the installation to include more repositories