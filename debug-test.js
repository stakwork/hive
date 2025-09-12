// Quick debug script to understand what's happening
const fs = require('fs');
const path = require('path');

// Read the route.ts file
const routePath = path.join(__dirname, 'src/app/api/chat/message/route.ts');
const routeContent = fs.readFileSync(routePath, 'utf8');

console.log('Looking for workflow data return...');

// Find the return statement
const returnMatch = routeContent.match(/return NextResponse\.json\(\s*\{[\s\S]*?\},[\s\S]*?\);/);
if (returnMatch) {
  console.log('Found return statement:');
  console.log(returnMatch[0]);
} else {
  console.log('Could not find return statement');
}

// Check if workflow data is included
console.log('\nLooking for stakworkData usage...');
const stakworkMatches = routeContent.match(/stakworkData[^;]*;/g);
if (stakworkMatches) {
  stakworkMatches.forEach(match => {
    console.log(match);
  });
} else {
  console.log('No stakworkData usage found');
}
