import { POST } from './src/app/api/pool-manager/claim-pod/[workspaceId]/route.js';

const request = new Request("http://localhost:3000/api/test", {
  method: "POST",
});

try {
  const response = await POST(request, {
    params: Promise.resolve({ workspaceId: "" }),
  });
  console.log("Response status:", response.status);
  const data = await response.json();
  console.log("Response data:", data);
} catch (error) {
  console.error("Error:", error);
}
