import { z } from "zod";

/**
 * A persona is a compact, prompt-ready description of a fictional but realistic
 * person. We keep a small set of structured fields for cohort filtering plus a
 * free-text `summary` that gets injected into the agent prompt. This maps down
 * from richer sources (e.g. MatrAIx Persona 1M) via scripts/download-personas.
 */
export const PersonaSchema = z.object({
  id: z.string(),
  name: z.string(),
  ageRange: z.string(),
  region: z.string(),
  occupation: z.string(),
  /** One-paragraph description the persona agent is told to embody. */
  summary: z.string(),
  /** Extra categorical attributes for filtering/segmenting cohorts. */
  attributes: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type Persona = z.infer<typeof PersonaSchema>;

/** Predicate used to build a cohort from the persona pool. */
export type CohortFilter = (p: Persona) => boolean;

/** Structured self-report a persona returns after a survey-style scenario. */
export const SurveyReportSchema = z.object({
  /** The persona's headline decision/answer, scenario-defined meaning. */
  answer: z.string(),
  /** 1-5 how satisfied / how likely to continue, persona's own rating. */
  rating: z.number().min(1).max(5),
  /** Short first-person reasoning. */
  reasoning: z.string(),
  /** Concrete friction points or confusions encountered. */
  frictions: z.array(z.string()).default([]),
  /** Whether the persona considers the task successfully completed. */
  succeeded: z.boolean(),
});
export type SurveyReport = z.infer<typeof SurveyReportSchema>;

export type ChatMessage = { role: "assistant" | "user"; content: string };

/** Outcome of running one persona through one scenario. */
export type TrialResult = {
  persona: Persona;
  scenarioId: string;
  env: "survey" | "chat";
  transcript: ChatMessage[];
  report: SurveyReport;
  error?: string;
};

/**
 * A Scenario is what a project defines to test itself. Two flavors:
 *  - survey: single-shot. Persona reads `task` (a described flow or question)
 *    and returns a structured SurveyReport.
 *  - chat: multi-turn. Persona talks to `respond` (your assistant/bot/endpoint)
 *    for up to `turns`, then self-reports.
 */
export type Scenario = {
  id: string;
  env: "survey" | "chat";
  /** Context about the product/app the persona is interacting with. */
  system: string;
  /** The task the persona attempts or the question they answer. */
  task: string;
  /** Chat-only: produce the assistant's reply given the conversation so far. */
  respond?: (messages: ChatMessage[], persona: Persona) => Promise<string>;
  /** Chat-only: max persona turns before self-report. Default 6. */
  turns?: number;
};
