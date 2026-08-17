import { hashPassword } from "./security.js";

const password = process.argv[2];
if (!password || password.length < 16) {
  console.error("Password must contain at least 16 characters.");
  process.exit(1);
}

console.log(await hashPassword(password));
