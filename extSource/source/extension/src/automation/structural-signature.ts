export interface StructuralEvidence {
  formSignature: string;
  pageSignatures: string[];
}

export interface StructuralRecipeLike {
  domain: string;
  formSignature?: string;
  pageSignatures?: string[];
}

export interface StructuralRecipeMatch<TRecipe extends StructuralRecipeLike = StructuralRecipeLike> {
  recipe: TRecipe;
  score: number;
  matchedSignals: string[];
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^a-z0-9:|.-]+/g, " ").split(/\s+/).filter(Boolean));
}

function overlap(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count / Math.max(left.size, right.size);
}

function signalFamily(value: string): string {
  return value.split(":", 1)[0];
}

export function matchStructuralRecipe<TRecipe extends StructuralRecipeLike>(recipe: TRecipe, evidence: StructuralEvidence): StructuralRecipeMatch<TRecipe> | null {
  const formScore = recipe.formSignature && evidence.formSignature
    ? overlap(tokens(recipe.formSignature), tokens(evidence.formSignature))
    : 0;
  const recipePage = new Set(recipe.pageSignatures || []);
  const evidencePage = new Set(evidence.pageSignatures);
  const matchedPage = [...recipePage].filter((signal) => evidencePage.has(signal));
  const pageScore = overlap(recipePage, evidencePage);
  const matchedFamilies = new Set(matchedPage.map(signalFamily));
  const workflowFamilies = [...matchedFamilies].filter((family) => ["family", "query", "transition", "path"].includes(family));
  const independentSignals = [
    formScore >= 0.75 ? "form" : "",
    ...workflowFamilies,
  ].filter(Boolean);
  if (independentSignals.length < 2) return null;
  const score = formScore * 0.55 + pageScore * 0.45;
  if (score < 0.75) return null;
  return { recipe, score, matchedSignals: [formScore >= 0.75 ? "formSignature" : "", ...matchedPage].filter(Boolean) };
}

export function chooseStructuralRecipe<TRecipe extends StructuralRecipeLike>(recipes: TRecipe[], currentDomain: string, evidence: StructuralEvidence): StructuralRecipeMatch<TRecipe> | null {
  const ranked = recipes
    .filter((recipe) => recipe.domain !== currentDomain)
    .map((recipe) => matchStructuralRecipe(recipe, evidence))
    .filter((match): match is StructuralRecipeMatch<TRecipe> => Boolean(match))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best || runnerUp && best.score - runnerUp.score < 0.12) return null;
  return best;
}

export function structuralEvidenceFromSignals(signals: {
  stage: string;
  familySignature?: string;
  url: string;
  formSignature: string;
  editableCount: number;
  selectCount: number;
  fileCount: number;
}): StructuralEvidence {
  let queryKeys = "";
  try {
    queryKeys = [...new URL(signals.url).searchParams.keys()].sort().join(",");
  } catch {
    queryKeys = "";
  }
  const pageSignatures = [
    `stage:${signals.stage}`,
    signals.familySignature ? `family:${signals.familySignature}` : "",
    queryKeys ? `query:${queryKeys}` : "",
    `controls:editable-${Math.min(signals.editableCount, 5)}`,
    `controls:select-${Math.min(signals.selectCount, 5)}`,
    `controls:file-${Math.min(signals.fileCount, 3)}`,
  ].filter(Boolean);
  return { formSignature: signals.formSignature, pageSignatures };
}
