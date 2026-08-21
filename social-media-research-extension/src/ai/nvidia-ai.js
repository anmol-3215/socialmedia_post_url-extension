/**
 * nvidia-ai.js — NVIDIA NIM API integration for social media fraud classification.
 *
 * Uses the NVIDIA OpenAI-compatible completions endpoint to analyze extracted social media posts
 * for financial scam patterns, calculate risk scores (0-100%), detect languages,
 * and extract key threat entities (Telegram channels, WhatsApp numbers, fake trading apps, bank names).
 */

import { createLogger } from "../shared/logger.js";

const logger = createLogger("nvidia-ai");

const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_MODEL = "meta/llama-3.1-70b-instruct";
const NVIDIA_API_KEY = "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";

/**
 * System prompt tailored for financial fraud, cyber-enabled scam analysis in India & global regions.
 */
const SYSTEM_PROMPT = `You are a Senior Cyber-Financial Crime & AI Threat Analyst specializing in Indian financial fraud, deceptive investment schemes, online task scams, and cyber fraud on social media platforms.

Your task is to analyze social media post captions/transcripts and return a strictly valid JSON response classifying the threat.

Return JSON in this EXACT structure:
{
  "fraud_category": "Investment Scam | Task/Part-Time Job Fraud | UPI/Banking Fraud | Fake Trading App/SEBI Impersonation | Crypto/Ponzi | Loan/Lottery Scam | Legitimate/Informational | Neutral/Unrelated",
  "risk_score": <number between 0 and 100>,
  "is_scam": <boolean>,
  "language": "Hindi | English | Hinglish | Other",
  "threat_entities": ["telegram channel", "phone number", "app name", "bank name", etc.],
  "ai_summary": "<1-2 sentence concise explanation of why this is or is not deceptive>"
}`;

/**
 * Analyze a single post caption using NVIDIA AI NIM API.
 * @param {string} caption
 * @param {string} platform
 * @returns {Promise<object>} Analysis result
 */
export async function analyzePostWithAI(caption, platform = "general") {
  if (!caption || caption.trim().length < 5) {
    return {
      fraud_category: "Neutral/Unrelated",
      risk_score: 0,
      is_scam: false,
      language: "Unknown",
      threat_entities: [],
      ai_summary: "Insufficient text content for analysis.",
    };
  }

  const prompt = `Analyze this ${platform} post content for deceptive financial patterns or cyber fraud:\n\n"""\n${caption.slice(0, 1500)}\n"""`;

  try {
    const response = await fetch(NVIDIA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        top_p: 0.7,
        max_tokens: 350,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.warn(`NVIDIA AI API error (${response.status}): ${errText}`);
      return fallbackAnalysis(caption);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return fallbackAnalysis(caption);
    }

    try {
      const parsed = JSON.parse(content);
      return {
        fraud_category: parsed.fraud_category || "Neutral/Unrelated",
        risk_score: typeof parsed.risk_score === "number" ? Math.min(100, Math.max(0, parsed.risk_score)) : 10,
        is_scam: Boolean(parsed.is_scam),
        language: parsed.language || "Unknown",
        threat_entities: Array.isArray(parsed.threat_entities) ? parsed.threat_entities : [],
        ai_summary: parsed.ai_summary || "Processed by NVIDIA AI.",
      };
    } catch {
      logger.debug("Failed to parse JSON response from NVIDIA AI, using heuristic parsing");
      return fallbackAnalysis(caption);
    }
  } catch (err) {
    logger.error(`NVIDIA AI request failed: ${err.message}`);
    return fallbackAnalysis(caption);
  }
}

/**
 * Fast offline heuristic fallback if API is unreachable.
 * @param {string} caption
 */
function fallbackAnalysis(caption) {
  const lower = caption.toLowerCase();
  let category = "Neutral/Unrelated";
  let score = 5;
  let isScam = false;

  if (/(guaranteed return|daily profit|100% profit|double your money|investment plan)/i.test(lower)) {
    category = "Investment Scam";
    score = 85;
    isScam = true;
  } else if (/(part time job|like and subscribe|earn daily|telegram task|wfh salary)/i.test(lower)) {
    category = "Task/Part-Time Job Fraud";
    score = 90;
    isScam = true;
  } else if (/(upi pin|lottery|rbi award|kyc expired|apk download)/i.test(lower)) {
    category = "UPI/Banking Fraud";
    score = 95;
    isScam = true;
  } else if (/(scam alert|fraud warning|beware of|police warning|cyber crime)/i.test(lower)) {
    category = "Legitimate/Informational";
    score = 15;
    isScam = false;
  }

  return {
    fraud_category: category,
    risk_score: score,
    is_scam: isScam,
    language: /[\u0900-\u097F]/.test(caption) ? "Hindi" : "English",
    threat_entities: [],
    ai_summary: `Heuristic assessment based on keyword patterns.`,
  };
}
