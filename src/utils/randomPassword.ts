export function generateRandomPassword(length = 12) {
  const charset =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+[]{}|;:,.<>?";
  
  // Handle edge cases
  if (length === null || length === undefined || isNaN(length) || length < 0 || !isFinite(length)) {
    if (length === undefined) {
      length = 12; // Use default
    } else {
      return ""; // Return empty string for invalid inputs
    }
  }
  
  // Ensure length is an integer
  length = Math.floor(length);
  
  let password = "";
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    password += charset[randomIndex];
  }
  return password;
}
