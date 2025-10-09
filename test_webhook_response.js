// Quick script to test what the webhook API actually returns
const { POST } = require('./dist/app/api/github/webhook/ensure/route.js');

async function testResponse() {
  const request = {
    json: async () => ({
      workspaceId: 'test',
      // Missing repositoryUrl/repositoryId
    })
  };

  try {
    const response = await POST(request);
    console.log('Status:', response.status);
    const body = await response.json();
    console.log('Body:', JSON.stringify(body, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  }
}

testResponse();
