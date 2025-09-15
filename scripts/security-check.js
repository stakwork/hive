#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔒 Running security audit for stakwork/hive...\n');

// Colors for output
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function runAudit() {
  try {
    log('1. Running npm audit...', colors.blue);
    
    // Run audit and capture both stdout and potential errors
    const auditOutput = execSync('npm audit --json', { 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    const auditData = JSON.parse(auditOutput);
    const vulns = auditData.metadata?.vulnerabilities || {};
    
    const total = Object.values(vulns).reduce((a, b) => a + b, 0);
    
    if (total === 0) {
      log('✅ No vulnerabilities found!', colors.green);
      return true;
    }
    
    log(`⚠️  Found ${total} vulnerabilities:`, colors.yellow);
    log(`   - Info: ${vulns.info || 0}`);
    log(`   - Low: ${vulns.low || 0}`);
    log(`   - Moderate: ${vulns.moderate || 0}`, colors.yellow);
    log(`   - High: ${vulns.high || 0}`, colors.red);
    log(`   - Critical: ${vulns.critical || 0}`, colors.red);
    
    // Save detailed audit results
    const resultsFile = path.join(__dirname, '../audit-results.json');
    fs.writeFileSync(resultsFile, JSON.stringify(auditData, null, 2));
    log(`\n📄 Detailed results saved to: ${resultsFile}`, colors.blue);
    
    // Check for high/critical vulnerabilities
    const criticalCount = (vulns.high || 0) + (vulns.critical || 0);
    if (criticalCount > 0) {
      log(`\n❌ Found ${criticalCount} high/critical vulnerabilities that need immediate attention!`, colors.red);
      log('Run "npm audit fix" to attempt automatic fixes.', colors.yellow);
      return false;
    }
    
    log('\n✅ No critical vulnerabilities found, but consider fixing moderate issues.', colors.green);
    return true;
    
  } catch (error) {
    // npm audit exits with code 1 when vulnerabilities are found
    if (error.status === 1) {
      try {
        const auditData = JSON.parse(error.stdout);
        log('⚠️  Vulnerabilities detected, processing results...', colors.yellow);
        
        const vulns = auditData.metadata?.vulnerabilities || {};
        const total = Object.values(vulns).reduce((a, b) => a + b, 0);
        
        log(`Found ${total} vulnerabilities:`, colors.yellow);
        log(`   - Info: ${vulns.info || 0}`);
        log(`   - Low: ${vulns.low || 0}`);
        log(`   - Moderate: ${vulns.moderate || 0}`, colors.yellow);
        log(`   - High: ${vulns.high || 0}`, colors.red);
        log(`   - Critical: ${vulns.critical || 0}`, colors.red);
        
        // Save results
        const resultsFile = path.join(__dirname, '../audit-results.json');
        fs.writeFileSync(resultsFile, JSON.stringify(auditData, null, 2));
        log(`\nDetailed results saved to: ${resultsFile}`, colors.blue);
        
        const criticalCount = (vulns.high || 0) + (vulns.critical || 0);
        return criticalCount === 0;
        
      } catch (parseError) {
        log('❌ Error parsing audit results:', colors.red);
        log(error.stdout, colors.red);
        return false;
      }
    } else {
      log('❌ Error running npm audit:', colors.red);
      log(error.message, colors.red);
      return false;
    }
  }
}

function checkDependencyVersions() {
  log('\n2. Checking dependency versions...', colors.blue);
  
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const criticalDeps = ['axios', 'next', 'prismjs', 'react', 'next-auth'];
    
    log('Critical security dependencies:');
    criticalDeps.forEach(dep => {
      const version = packageJson.dependencies?.[dep] || packageJson.devDependencies?.[dep];
      if (version) {
        log(`   ${dep}: ${version}`, colors.green);
      } else {
        log(`   ${dep}: not found`, colors.yellow);
      }
    });
    
  } catch (error) {
    log('❌ Error reading package.json:', colors.red);
    log(error.message, colors.red);
  }
}

function generateReport() {
  log('\n3. Security recommendations...', colors.blue);
  
  const recommendations = [
    '🔧 Run "npm audit fix" to automatically fix vulnerabilities',
    '📋 Review audit-results.json for detailed vulnerability information',
    '🔄 Keep dependencies updated regularly',
    '🛡️  Enable Dependabot for automated security updates',
    '⚡ Consider using "npm ci" in production for exact dependency versions',
    '🔍 Review GitHub Security Advisories for this repository'
  ];
  
  recommendations.forEach(rec => log(`   ${rec}`));
}

// Main execution
async function main() {
  const auditPassed = runAudit();
  checkDependencyVersions();
  generateReport();
  
  log('\n🔒 Security audit complete!', colors.blue);
  
  if (!auditPassed) {
    log('\n❌ Security issues found - please address high/critical vulnerabilities before deploying.', colors.red);
    process.exit(1);
  } else {
    log('\n✅ Security check passed!', colors.green);
    process.exit(0);
  }
}

if (require.main === module) {
  main().catch(error => {
    log('❌ Security check failed:', colors.red);
    log(error.message, colors.red);
    process.exit(1);
  });
}

module.exports = { runAudit, checkDependencyVersions, generateReport };