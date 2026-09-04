import type { Category } from "@prisma/client";

const RULES: Array<{ category: Category; keywords: string[] }> = [
  { category: "AI_ML", keywords: ["machine-learning", "deep-learning", "llm", "ai", "ml", "pytorch", "tensorflow", "nlp"] },
  { category: "WEB", keywords: ["react", "vue", "nextjs", "frontend", "web", "css", "html", "svelte", "angular"] },
  { category: "MOBILE", keywords: ["android", "ios", "flutter", "react-native", "mobile", "swift", "kotlin"] },
  { category: "DEVOPS", keywords: ["docker", "kubernetes", "ci-cd", "devops", "terraform", "infrastructure", "helm"] },
  { category: "DATABASE", keywords: ["database", "sql", "postgres", "mysql", "orm", "nosql", "redis"] },
  { category: "SECURITY", keywords: ["security", "encryption", "vulnerability", "pentest", "auth", "oauth"] },
  { category: "GAME_DEV", keywords: ["game", "gamedev", "unity", "godot", "unreal"] },
  { category: "CLI_TOOLING", keywords: ["cli", "tool", "terminal", "devtools", "productivity"] },
  { category: "LIBRARY", keywords: ["library", "sdk", "framework", "package"] },
];

export function inferCategory(topics: string[], language?: string | null): Category {
  const haystack = [...topics.map((t) => t.toLowerCase()), (language ?? "").toLowerCase()];
  for (const rule of RULES) {
    if (rule.keywords.some((kw) => haystack.includes(kw))) {
      return rule.category;
    }
  }
  return "OTHER";
}
