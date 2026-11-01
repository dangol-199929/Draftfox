// Sets the Draftfox login password: writes its hash (DRAFTFOX_PASSWORD_HASH) and a fresh AUTH_SECRET into .env.
// A new secret signs out every browser, so an old session can't outlive a password change.
//   pnpm set-password                     asks for the new password
//   pnpm set-password --random <file>     makes a random password and saves it to <file> (for first setup)
// Restart the Draftfox server afterwards so it reads the new .env.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { hashPassword } from "../src/lib/auth.ts";

const ENV_FILE = join(import.meta.dirname, "..", ".env");
const MIN_LENGTH = 10;

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Don't echo what's typed.
  const output = rl as unknown as { _writeToOutput: (text: string) => void; output: NodeJS.WriteStream };
  output._writeToOutput = (text) => {
    if (text.includes(question)) output.output.write(text);
  };
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    }),
  );
}

function setEnvValues(values: Record<string, string>) {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split(/\r?\n/) : [];
  for (const [name, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => new RegExp(`^\\s*${name}\\s*=`).test(line));
    if (index >= 0) lines[index] = `${name}=${value}`;
    else {
      if (lines.length && lines.at(-1) === "") lines.pop();
      lines.push(`${name}=${value}`, "");
    }
  }
  writeFileSync(ENV_FILE, lines.join("\n"));
}

async function main() {
  const randomIndex = process.argv.indexOf("--random");
  let password: string;
  if (randomIndex >= 0) {
    const file = process.argv[randomIndex + 1];
    if (!file) throw new Error("Say where to save the password: pnpm set-password --random <file>");
    password = randomBytes(15).toString("base64url");
    writeFileSync(file, `Draftfox login password: ${password}\nChange it with: pnpm set-password\n`);
    console.log(`Saved a new random password to ${file}`);
  } else {
    password = await ask("New Draftfox password: ");
    if (password.length < MIN_LENGTH) throw new Error(`Use at least ${MIN_LENGTH} characters.`);
    if ((await ask("Type it again: ")) !== password) throw new Error("The two passwords don't match.");
  }

  setEnvValues({
    DRAFTFOX_PASSWORD_HASH: await hashPassword(password),
    AUTH_SECRET: randomBytes(32).toString("base64url"),
  });
  console.log("Password updated in .env. Restart Draftfox to use it (everyone is signed out).");
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
