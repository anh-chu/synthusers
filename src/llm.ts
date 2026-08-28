import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * Provider-agnostic model factory. MODEL is "provider/id", e.g.
 *   anthropic/claude-haiku-4-5
 *   openai/gpt-4o-mini
 * Reads ANTHROPIC_API_KEY / OPENAI_API_KEY from env.
 */
export function getModel(spec = process.env.MODEL ?? "openai/gpt-4o-mini"): LanguageModel {
  const slash = spec.indexOf("/");
  if (slash === -1) throw new Error(`MODEL must be "provider/id", got: ${spec}`);
  const provider = spec.slice(0, slash);
  const id = spec.slice(slash + 1);

  switch (provider) {
    case "anthropic": {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("ANTHROPIC_API_KEY not set");
      return createAnthropic({ apiKey: key })(id);
    }
    case "openai": {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY not set");
      return createOpenAI({ apiKey: key })(id);
    }
    default:
      throw new Error(`Unknown provider "${provider}". Use anthropic/* or openai/*`);
  }
}
