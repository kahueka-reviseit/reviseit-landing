/** Named values shared with the teacher catalogue; numeric levels remain curriculum-specific. */
export const COGNITIVE_CATEGORIES = ['Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create'] as const;
export const PHYSICAL_SCIENCES_LEVELS: Record<string, number> = { Remember: 1, Understand: 2, Apply: 3, Analyse: 3, Evaluate: 4, Create: 4 };
// Source: curriculum-policy.md, CAPS Physical Sciences Appendix 1, printed pages 152–153.
// Do not apply this grouping to an unrelated curriculum or subject.
export const hasPhysicalSciencesLevels = (moduleId: string) => /^caps-grade-(10|11|12)-physical-sciences$/.test(moduleId);
