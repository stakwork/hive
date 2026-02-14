const fetch = require('node-fetch');

async function testQuickAsk() {
  try {
    console.log('Testing /api/ask/quick endpoint...');
    
    // First, let's try to get a session or create a test request
    const response = await fetch('http://localhost:3000/api/ask/quick', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'next-auth.session-token=test' // This will fail auth but let's see the error
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        workspaceSlug: 'mock-stakgraph'
      })
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers.raw());
    
    const text = await response.text();
    console.log('Response body:', text);
    
  } catch (error) {
    console.error('Test error:', error);
  }
}

testQuickAsk();
