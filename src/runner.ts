import { generateObject, generateText } from "ai";
import { getModel } from "./llm.js";
import {
  SurveyReportSchema,
  type ChatMessage,
  type Persona,
  type Scenario,
  type TrialResult,
} from "./types.js";

function personaSystem(persona: Persona, scenario: Scenario): string {
  return [
    `You are role-playing a specific person interacting with a product. Stay in character at all times. React the way THIS person genuinely would, including impatience, confusion, or delight. Do not be a helpful assistant; be this user.`,
    ``,
    `# Who you are`,
    `Name: ${persona.name}`,
    `Age: ${persona.ageRange} | Region: ${persona.region} | Occupation: ${persona.occupation}`,
    persona.summary,
    ``,
    `# The product / context`,
    scenario.system,
  ].join("\n");
}

const REPORT_INSTRUCTION = `Now step out of the interaction and report honestly as this person. Base every field ONLY on what actually happened above. rating is 1 (terrible) to 5 (great) from this person's point of view. List concrete frictions you hit; empty if none. succeeded = did YOU accomplish the task.`;

/** Survey env: single-shot. Persona reads the task and self-reports. */
async function runSurvey(persona: Persona, scenario: Scenario): Promise<TrialResult> {
  const model = getModel();
  const system = personaSystem(persona, scenario);
  const prompt = `# Your task\n${scenario.task}\n\n${REPORT_INSTRUCTION}`;

  const { object } = await generateObject({
    model,
    schema: SurveyReportSchema,
    system,
    prompt,
  });

  return {
    persona,
    scenarioId: scenario.id,
    env: "survey",
    transcript: [{ role: "user", content: scenario.task }],
    report: object,
  };
}

/** Chat env: persona converses with scenario.respond, then self-reports. */
async function runChat(persona: Persona, scenario: Scenario): Promise<TrialResult> {
  if (!scenario.respond) throw new Error(`Chat scenario "${scenario.id}" needs a respond()`);
  const model = getModel();
  const system = personaSystem(persona, scenario);
  const maxTurns = scenario.turns ?? 6;

  // transcript is from the PERSONA's perspective: assistant = the bot, user = persona.
  const transcript: ChatMessage[] = [];
  // Seed with the bot's opening (or the task as the first bot prompt).
  const opening = await scenario.respond([], persona);
  transcript.push({ role: "assistant", content: opening });

  for (let turn = 0; turn < maxTurns; turn++) {
    // Persona replies to the conversation so far.
    const personaMsgs = transcript.map((m) => ({
      role: m.role === "assistant" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));
    const { text } = await generateText({
      model,
      system: `${system}\n\n# Your task\n${scenario.task}\n\nRespond as this person to the latest message. Keep it natural and in-character. If you are done or want to leave, say so plainly.`,
      messages: personaMsgs,
    });
    transcript.push({ role: "user", content: text });

    if (/\b(done|bye|leave|quit|stop|that'?s all)\b/i.test(text)) break;

    const reply = await scenario.respond(transcript, persona);
    transcript.push({ role: "assistant", content: reply });
  }

  // Self-report.
  const { object } = await generateObject({
    model,
    schema: SurveyReportSchema,
    system,
    prompt: `Here is the full conversation you just had:\n\n${transcript
      .map((m) => `${m.role === "assistant" ? "APP" : "YOU"}: ${m.content}`)
      .join("\n")}\n\n${REPORT_INSTRUCTION}`,
  });

  return { persona, scenarioId: scenario.id, env: "chat", transcript, report: object };
}

/** Run one persona through a scenario, capturing errors per-trial. */
export async function runTrial(persona: Persona, scenario: Scenario): Promise<TrialResult> {
  try {
    return scenario.env === "chat"
      ? await runChat(persona, scenario)
      : await runSurvey(persona, scenario);
  } catch (e) {
    return {
      persona,
      scenarioId: scenario.id,
      env: scenario.env,
      transcript: [],
      report: { answer: "", rating: 1, reasoning: "", frictions: [], succeeded: false },
      error: (e as Error).message,
    };
  }
}

/** Run a cohort with bounded concurrency. */
export async function runCohort(
  personas: Persona[],
  scenario: Scenario,
  concurrency = 4
): Promise<TrialResult[]> {
  const results: TrialResult[] = new Array(personas.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= personas.length) return;
      results[i] = await runTrial(personas[i]!, scenario);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, personas.length) }, worker));
  return results;
}
