import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const key =
  process.env.GOOGLE_GENAI_API_KEY ||
  process.env.GEMINI_API_KEY;

if (!key) {
  console.error("Missing GOOGLE_GENAI_API_KEY / GEMINI_API_KEY");
  process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

const res = await fetch(url);
const text = await res.text();


if (!res.ok) {
  console.error("ListModels failed:", res.status, text);
  process.exit(1);
}

const json = JSON.parse(text);
for (const m of json.models ?? []) {
  const name = m.name; // looks like "models/...."
  const methods = (m.supportedGenerationMethods ?? []).join(", ");
  console.log(`${name}  |  ${methods}`);
}
