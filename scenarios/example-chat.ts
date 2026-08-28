import { generateText } from "ai";
import { getModel } from "../src/llm.js";
import type { ChatMessage, Scenario } from "../src/types.js";

/**
 * Example CHAT scenario. `respond` is YOUR assistant/bot under test. Here it is
 * a stand-in LLM support bot; in a real test you would call your own chat API
 * (fetch your endpoint) instead, so the harness stress-tests the real thing.
 */
const scenario: Scenario = {
  id: "example-chat",
  env: "chat",
  system: `You are chatting with the in-app support assistant of "Seedwise", a savings app. You have a question or problem and want it resolved.`,
  task: `You want to cancel your subscription and get a refund because you were charged twice. See if the assistant actually helps you.`,
  turns: 5,
  respond: async (messages: ChatMessage[], _persona) => {
    // Replace this block with a fetch() to your real chat endpoint.
    if (messages.length === 0) return "Hi! I'm the Seedwise assistant. How can I help you today?";
    const { text } = await generateText({
      model: getModel(),
      system: `You are Seedwise's support bot. Be concise. You CAN process refunds for duplicate charges and cancel subscriptions, but you must first ask for the account email and the charge date.`,
      messages: messages.map((m) => ({
        // From the bot's perspective, the persona is the user.
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      })),
    });
    return text;
  },
};

export default scenario;
