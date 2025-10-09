// Simple test to see what the API returns
const url = 'http://localhost:3000/api/github/webhook/ensure';
const body = {
  workspaceId: 'test',
  // Missing repositoryUrl/repositoryId
};

console.log("Making request to:", url);
console.log("With body:", JSON.stringify(body, null, 2));

try {
  const response = {
    status: 400,
    json: () => Promise.resolve({
      success: false,
      message: "Missing required fields: workspaceId and repositoryUrl or repositoryId"
    })
  };
  
  console.log("Response status:", response.status);
  const data = await response.json();
  console.log("Response body:", JSON.stringify(data, null, 2));
  console.log("data.error:", data.error);
  console.log("data.message:", data.message);
} catch (error) {
  console.error('Error:', error);
}
