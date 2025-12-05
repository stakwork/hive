import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// node scripts/test_file.js

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, "test_file.md");

/*

first the the file scripts/test_file.md, tell me the string after the word "value:", then replace that string with the text DONE

*/

// Function to generate a random string
function generateRandomString(length = 20) {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

function finalText() {
  const randomContent = generateRandomString(10);

  return `value: ${randomContent}
    
  -- 
  
  one
  two
  three
  four
  blah
  blah
  blah
  `;
}

let i = 0;

// Function to update the file
function updateFile() {
  // First, read the file to check if it says "DONE"
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading file:", err);
      return;
    }

    // Check if content is "DONE"
    if (data.includes("value: DONE")) {
      console.log('File contains "value: DONE". Stopping updates...');
      clearInterval(intervalId);
      process.exit(0);
      return;
    }

    // If not DONE, update with random content
    fs.writeFile(filePath, finalText(), "utf8", (err) => {
      if (err) {
        console.error("Error writing to file:", err);
        return;
      }
      console.log(`[${new Date().toISOString()}] File updated! [${i}]`);
      i++;
    });
  });
}

// Create the scripts directory if it doesn't exist
const scriptsDir = path.join(__dirname, "scripts");
if (!fs.existsSync(scriptsDir)) {
  fs.mkdirSync(scriptsDir, { recursive: true });
  console.log("Created scripts directory");
}

// Create the file if it doesn't exist
if (!fs.existsSync(filePath)) {
  fs.writeFileSync(filePath, "Initial content", "utf8");
  console.log("Created test_file.md");
}

// Update immediately on start
updateFile();

// Set interval to update every 2 seconds
const intervalId = setInterval(updateFile, 100);

// Optional: Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\nStopping file updates...");
  clearInterval(intervalId);
  process.exit(0);
});

console.log("Started updating test_file.md every 2 seconds. Press Ctrl+C to stop.");
console.log('To stop the script, write "DONE" to test_file.md');
